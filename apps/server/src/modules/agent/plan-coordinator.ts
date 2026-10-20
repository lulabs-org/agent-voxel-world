import {
  PlanService,
  TaskScheduler,
  validatePlan,
  newPlan,
  nextOccurrence,
  duePlans,
} from '../tasks';
import { hasPlanTokenLimit, isRepeating } from '@voxel/shared';
import type { RpcParams } from '@voxel/gateway-protocol';
import { object } from '../../common/validation';
import { AppError } from '../../common/errors';
import type { Job } from './types';
import {
  commitExecution,
  getTaskPlans,
  getTaskRuns,
  reserveRun,
  taskBusy,
  executeTaskPlanControl,
  executeTaskRunControl,
} from './task-execution';
import type { AgentPersistence } from './persistence';
import type { AgentEvents } from './events';
import type { SavedProvider } from '../providers/provider-validation';

export type PlanCoordinatorHost = {
  taskJob: (id: string) => Job;
  jobById: (id: string) => Job | undefined;
  allJobs: () => Iterable<Job>;
  save: () => Promise<void>;
  schedule: (job: Job) => void;
  launchReserved: (job: Job) => void;
  controlTask: (id: string, op: 'pause' | 'cancel') => Promise<unknown>;
  getProvider: (id: string) => SavedProvider;
  persistence: AgentPersistence;
  events: AgentEvents;
  isClosing: () => boolean;
  assertWritable: (id?: string) => void;
};

export class AgentPlanCoordinator {
  readonly plans = new PlanService();
  readonly committedPlans = new PlanService();
  readonly planScheduler: TaskScheduler;
  private changingPlans = new Set<string>();

  constructor(private readonly host: PlanCoordinatorHost) {
    this.planScheduler = new TaskScheduler(() => this.dispatchDue());
  }

  publicPlans(id?: string, metadata = false) {
    const plans = this.committedPlans.views(id).map((p) => ({
      ...p,
      agentName: p.agentId
        ? (this.host.persistence.committedAgentName(p.agentId) ?? p.agentName)
        : p.agentName,
    }));
    return metadata
      ? plans.map((plan) => ({
          ...plan,
          resourceVersion: this.host.events.version,
          taskIdentity: plan.agentId
            ? (this.host.persistence.publicIdentity(plan.agentId) ?? null)
            : null,
        }))
      : plans;
  }

  publicRuns(
    id: string | undefined,
    plan: string,
    offset?: number,
    metadata = false,
  ) {
    if (id) this.committedPlans.assertBinding(plan, id);
    const page = this.committedPlans.history(plan, offset);
    if (!metadata) return page;
    const annotate = (run: (typeof page.items)[number]) => ({
      ...run,
      resourceVersion: this.host.events.version,
      taskIdentity: run.agentId
        ? (this.host.persistence.publicIdentity(run.agentId) ?? null)
        : null,
    });
    return {
      ...page,
      resourceVersion: this.host.events.version,
      items: page.items.map(annotate),
      active: page.active.map(annotate),
    };
  }

  planPage(p: RpcParams) {
    let all = this.publicPlans(p.agentId, true).filter(
      (plan) =>
        (!p.search ||
          plan.name
            .toLocaleLowerCase()
            .includes(p.search.toLocaleLowerCase())) &&
        (!p.state ||
          (p.state === 'unassigned'
            ? !plan.agentId && plan.state === 'paused'
            : plan.state === p.state)) &&
        (!p.timing || plan.timing.kind === p.timing),
    );
    if (!p.state) all = all.filter((plan) => plan.state !== 'archived');
    all.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    const offset = p.offset ?? 0;
    return {
      items: all.slice(offset, offset + 20),
      total: all.length,
      nextOffset: offset + 20 < all.length ? offset + 20 : undefined,
    };
  }

  publicPlan(id: string) {
    const p = this.publicPlans(undefined, true).find((p) => p.id === id);
    if (!p) throw new AppError('计划不存在。', 404);
    return p;
  }

  async reassignPlan(id: string, agentId: string) {
    const agent = this.host.taskJob(agentId);
    return this.commitPlan(id, () => this.plans.reassign(id, agent.view));
  }

  taskPlans(id: string) {
    return getTaskPlans(this.host.taskJob(id));
  }

  taskRuns(id: string, planId: string, offset = 0) {
    return getTaskRuns(this.host.taskJob(id), planId, offset);
  }

  async createTaskPlan(id: string, value: unknown) {
    this.host.assertWritable(id);
    if (this.host.persistence.planStorageFailed)
      throw new AppError('计划存档失败，请修复存储后重启。', 503);
    const job = this.host.taskJob(id);
    const requestId = object(value).requestId;
    if (
      requestId !== undefined &&
      (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(requestId))
    )
      throw new AppError('请求标识无效。');
    const priorId =
      typeof requestId === 'string' &&
      job.ledger.requests &&
      Object.hasOwn(job.ledger.requests, `${id}:${requestId}`)
        ? job.ledger.requests[`${id}:${requestId}`]
        : undefined;
    if (priorId)
      return structuredClone(job.ledger.plans.find((p) => p.id === priorId)!);
    const draft = validatePlan(value);
    if (draft.timing.kind === 'immediate' && (!job.session || taskBusy(job)))
      throw new AppError('请先让角色上线并结束或暂停当前执行。', 409);
    let runId: string | undefined;
    const plan = await commitExecution(
      job,
      () => {
        const p = {
          ...newPlan(draft, Date.now()),
          agentId: id,
          agentName: job.view.name,
        };
        job.ledger.plans.push(p);
        if (p.timing.kind === 'immediate')
          runId = reserveRun(job, p, 'manual', Date.now());
        if (typeof requestId === 'string')
          job.ledger.requests[`${id}:${requestId}`] = p.id;
        return p;
      },
      () => this.host.save(),
      (j) => this.host.schedule(j),
      draft.timing.kind === 'immediate',
    );
    if (runId) this.host.launchReserved(job);
    this.planScheduler.start();
    return structuredClone(plan);
  }

  async commitPlan<T>(planId: string, change: () => T) {
    if (this.host.persistence.planStorageFailed)
      throw new AppError('计划存档失败，请修复存储后重启。', 503);
    const bound = this.plans.get(planId).agentId;
    if (
      this.changingPlans.has(planId) ||
      (bound && this.host.jobById(bound)?.taskMutating)
    )
      throw new AppError('计划正在提交，请稍后重试。', 409);
    this.changingPlans.add(planId);
    const before = structuredClone(this.plans.get(planId));
    try {
      const value = change();
      await this.host.save();
      return value;
    } catch (e) {
      this.plans.plans[this.plans.plans.findIndex((p) => p.id === planId)] =
        before;
      throw e;
    } finally {
      this.changingPlans.delete(planId);
    }
  }

  async updateTaskPlan(id: string | undefined, planId: string, value: unknown) {
    const plan = this.plans.get(planId);
    if (id) this.plans.assertBinding(planId, id);
    if (plan.state === 'archived') throw new AppError('已归档任务不能修改。');
    const draft = validatePlan(value, Date.now(), plan);
    return this.commitPlan(planId, () => {
      Object.assign(plan, draft);
      this.plans.touch(plan);
      plan.nextRunAt =
        plan.state === 'enabled' ? nextOccurrence(plan, Date.now()) : undefined;
      return structuredClone(plan);
    });
  }

  async controlTaskPlan(
    id: string | undefined,
    planId: string,
    operation: string,
    value: unknown = {},
  ) {
    if (id) this.plans.assertBinding(planId, id);
    if (operation !== 'run')
      return this.commitPlan(planId, () =>
        this.plans.control(planId, operation, value),
      );
    const target = this.plans.get(planId).agentId;
    if (!target) throw new AppError('请先指派执行角色。', 409);
    return executeTaskPlanControl(
      this.host.taskJob(target),
      planId,
      operation,
      value,
      () => this.host.save(),
      (j) => this.host.schedule(j),
      (j) => this.host.launchReserved(j),
    );
  }

  async controlTaskRun(
    id: string | undefined,
    runId: string,
    operation: string,
    value: unknown = {},
  ) {
    const targetId = id || this.plans.run(runId).agentId;
    if (!targetId) throw new AppError('任务未关联执行角色。', 404);
    const job = this.host.taskJob(targetId);
    return executeTaskRunControl(
      job,
      runId,
      operation,
      value,
      this.host.getProvider(job.view.providerId),
      () => this.host.save(),
      (j) => this.host.schedule(j),
      (j) => this.host.launchReserved(j),
      (op) => this.host.controlTask(targetId, op),
    );
  }

  async dispatchDue(now = Date.now()) {
    if (this.host.isClosing() || this.host.persistence.planStorageFailed)
      return;
    for (const job of this.host.allJobs()) {
      if (
        job.storageFailed ||
        job.taskMutating ||
        job.updating ||
        job.controlling
      )
        continue;
      const due = duePlans(job.ledger, now).filter(
        (p) => p.agentId === job.view.id,
      );
      let selected = false;
      for (const plan of due) {
        if (this.changingPlans.has(plan.id)) continue;
        const at = plan.nextRunAt!;
        const skip =
          selected || taskBusy(job) || this.plans.unfinished(plan.id)
            ? '角色忙碌，本次触发已跳过。'
            : !job.session
              ? '角色离线，本次触发已错过。'
              : undefined;
        let runId: string | undefined;
        await commitExecution(
          job,
          () => {
            if (
              hasPlanTokenLimit(plan) &&
              plan.spentTokens >= plan.totalTokenBudget
            ) {
              plan.state = 'paused';
              plan.reason = '累计额度已用尽。';
              delete plan.nextRunAt;
              return;
            }
            runId = reserveRun(job, plan, 'scheduled', at, skip);
            plan.nextRunAt = isRepeating(plan.timing)
              ? nextOccurrence(plan, now)
              : undefined;
          },
          () => this.host.save(),
          (j) => this.host.schedule(j),
          !skip,
        );
        if (runId) {
          selected = true;
          this.host.launchReserved(job);
        }
      }
    }
  }
}

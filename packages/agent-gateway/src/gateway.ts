import { PlanService } from './plans/service';
import { migrateArchive } from './plans/archive';
import { GatewayScheduler } from './wake-scheduler';
import { PlanScheduler } from './plans/scheduler';
import { endedRun } from './plans/model';
import { appendAgentLog } from './agent-logs';
import {
  validatePlan,
  newPlan,
  newRun,
  nextOccurrence,
  duePlans,
} from './plans/model';
import {
  hasPlanTokenLimit,
  isRepeating,
  agentPermissions,
  type AgentSettings,
} from '@voxel/shared';
import { randomUUID } from 'node:crypto';
import type {
  VoiceServicePort,
  ProviderPort,
  ArchivePort,
  RestoredAgentRecord,
  GatewayArchive,
} from './ports';
import { AgentRegistry } from './registry';
import { GatewayEvents } from './events';
import { CommandRouter } from './command-router';
import { invokeGateway } from './dispatch';
import type { RpcParams, RpcMethod } from '@voxel/gateway-protocol';
import {
  Session,
  newTask,
  AgentAttention,
  AgentRunner,
  TaskService,
  listModels,
  nextIntervalMs,
  type AgentConfig,
} from '@voxel/agent-runtime';

import {
  object,
  text,
  boolean,
  validateAgent,
  taskLimits,
  type SavedProvider,
} from './validation';
import { ManagementError } from './errors';

import { active, resident, type Job } from './types';
import {
  captureTask,
  commitExecution,
  currentRun,
  getTaskPlans,
  getTaskRuns,
  reserveRun,
  taskBusy,
  executeTaskPlanControl,
  executeTaskRunControl,
} from './task-operations';
import { restoreAgentJob } from './restore';
import { AgentHost, type ExecutionContext } from './executor';

export * from './validation';

export class AgentGateway {
  private jobs = new AgentRegistry();
  readonly events = new GatewayEvents();
  readonly commands = new CommandRouter();
  private closing = false;
  private closePromise?: Promise<void>;
  private shutdownPresence = new Map<string, Job['view']['status']>();
  private probing = new Set<string>();
  private taskScheduler = new GatewayScheduler();
  private planScheduler = new PlanScheduler(() => this.dispatchDue());
  readonly plans = new PlanService();
  private committedPlans = new PlanService();
  private saving: Promise<void> = Promise.resolve();
  private committed = new Map<string, RestoredAgentRecord>();
  private committedViews: ReturnType<AgentGateway['list']> = [];
  storageRevision = 0;
  private planStorageFailed = false;

  assertWritable(id?: string) {
    if (this.closing) throw new ManagementError('世界服务正在关闭。', 503);
    if (id && this.jobs.get(id)?.storageFailed)
      throw new ManagementError(
        '存档失败，已停止此 Agent 的后续动作。请修复存储后重启服务。',
        503,
      );
  }
  publicList() {
    return structuredClone(this.committedViews);
  }
  publicIdentity(id: string) {
    return structuredClone(this.committed.get(id)?.runtime?.identity);
  }
  publicPlans(id?: string, metadata = false) {
    const plans = this.committedPlans.views(id).map((p) => ({
      ...p,
      agentName: p.agentId
        ? (this.committed.get(p.agentId)?.name ?? p.agentName)
        : p.agentName,
    }));
    return metadata
      ? plans.map((plan) => ({
          ...plan,
          resourceVersion: this.events.version,
          taskIdentity: plan.agentId
            ? (this.publicIdentity(plan.agentId) ?? null)
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
      resourceVersion: this.events.version,
      taskIdentity: run.agentId
        ? (this.publicIdentity(run.agentId) ?? null)
        : null,
    });
    return {
      ...page,
      resourceVersion: this.events.version,
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
    if (!p) throw new ManagementError('计划不存在。', 404);
    return p;
  }
  async reassignPlan(id: string, agentId: string) {
    const agent = this.taskJob(agentId);
    return this.commitPlan(id, () => this.plans.reassign(id, agent.view));
  }
  async settled(id: string) {
    await this.jobs.get(id)?.done;
  }

  private persist() {
    for (const job of this.jobs.values()) captureTask(job);
    const views = this.list();
    const records = [...views].reverse().map((view) => ({
      ...view,
      status: this.shutdownPresence.get(view.id) ?? view.status,
      sessionId: undefined,
      runtime: structuredClone(this.jobs.get(view.id)?.memory),
      currentRunId: this.jobs.get(view.id)?.currentRunId,
    }));
    const snapshot: GatewayArchive = {
      version: 1,
      agents: records,
      plans: structuredClone(this.plans.plans),
      runs: structuredClone(this.plans.runs),
      requests: { ...this.plans.requests },
    };
    this.saving = this.saving
      .catch(() => {})
      .then(async () => {
        try {
          await this.archive.save(snapshot);
        } catch (error) {
          this.storageRevision++;
          const changedPlans = snapshot.plans.filter(
            (p) =>
              JSON.stringify(p) !==
              JSON.stringify(
                this.committedPlans.plans.find((old) => old.id === p.id),
              ),
          );
          const changedRuns = snapshot.runs.filter(
            (r) =>
              JSON.stringify(r) !==
              JSON.stringify(
                this.committedPlans.runs.find((old) => old.id === r.id),
              ),
          );
          if (changedPlans.length || changedRuns.length)
            this.planStorageFailed = true;
          const affected = new Set(
            [...changedPlans, ...changedRuns].map((x) => x.agentId),
          );
          for (const record of records) {
            if (
              !affected.has(record.id) &&
              JSON.stringify(this.committed.get(record.id)) ===
                JSON.stringify(record)
            )
              continue;
            const job = this.jobs.get(record.id);
            if (job) {
              job.storageFailed = true;
              job.abort.abort();
              this.taskScheduler.cancel(record.id);
            }
          }
          throw error;
        }
        this.committed = new Map(records.map((record) => [record.id, record]));
        this.committedViews = views;
        Object.assign(this.committedPlans, {
          plans: snapshot.plans,
          runs: snapshot.runs,
          requests: snapshot.requests,
        });
        this.events.commit(records, snapshot);
      });
    void this.saving.catch(() => console.error('无法保存 Agent 记录。'));
  }

  private save(): Promise<void> {
    this.persist();
    return this.saving;
  }

  async load() {
    const raw = await this.archive.load();
    const saved = raw ? migrateArchive(raw) : undefined;
    if (!saved) {
      this.planScheduler.start();
      return;
    }
    Object.assign(this.plans, {
      plans: saved.plans,
      runs: saved.runs,
      requests: saved.requests,
    });
    const autoJoin: Job[] = [];
    for (const view of saved.agents) {
      const { job, voiceWarning, shouldAutoJoin } = restoreAgentJob(
        view,
        this.providers,
        (settings) => this.checkVoice(settings),
        this.plans,
      );
      this.jobs.set(view.id, job);
      if (voiceWarning) appendAgentLog(job.view, voiceWarning);
      if (shouldAutoJoin) autoJoin.push(job);
    }
    await this.save();
    for (const job of autoJoin.slice(0, 4)) {
      job.view.status = 'joining';
      job.done = this.execute(
        job,
        this.providers.get(job.view.providerId),
        false,
      );
      await job.done;
    }
    this.planScheduler.start();
  }

  constructor(
    readonly providers: ProviderPort,
    private serverUrl: string | (() => string),
    private dependencies: GatewayDependencies,
    readonly voiceServices: VoiceServicePort | undefined,
    private archive: ArchivePort,
  ) {}

  async dispatch(
    method: RpcMethod,
    params: RpcParams,
    commandId?: string,
    legacy = false,
  ) {
    return invokeGateway(this, method, params, commandId, legacy);
  }
  async flush(since = this.storageRevision) {
    await this.saving;
    if (since !== this.storageRevision)
      throw new ManagementError('保存失败，操作结果待确认，请检查存储。', 503);
  }
  currentRunId(id: string) {
    return this.jobs.get(id)?.currentRunId;
  }
  taskIdentity(id: string) {
    return this.jobs.get(id)?.memory.identity;
  }
  interrupt(id: string) {
    this.jobs.get(id)?.abort.abort();
  }
  private checkVoice(settings: AgentSettings) {
    if (settings.voiceReplies && !settings.voiceServiceId)
      throw new ManagementError('请先选择语音服务。');
    if (settings.voiceServiceId)
      this.voiceServices?.get(settings.voiceServiceId);
  }

  private bindVoice(job: Job) {
    if (job.view.sessionId)
      this.voiceServices?.bind(
        job.view.sessionId,
        job.view.voiceReplies && agentPermissions(job.view).chat
          ? job.view.voiceServiceId || 'local-default'
          : '',
      );
  }

  list() {
    return [...this.jobs.values()]
      .map(({ view, memory }) =>
        structuredClone({
          ...view,
          goal: memory.task?.goal ?? view.goal,
          voiceServiceName: this.voiceServices
            ?.list()
            .find((s) => s.id === view.voiceServiceId)?.name,
          task: memory.task,
          usage: memory.usage,
          lastResponse: memory.lastResponse,
          taskRequiresReassignment: !!memory.audienceExpired,
          logs: [...view.logs],
        }),
      )
      .reverse();
  }

  private taskJob(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (this.closing) throw new ManagementError('世界服务正在关闭。', 503);
    return job;
  }

  taskPlans(id: string) {
    return getTaskPlans(this.taskJob(id));
  }

  taskRuns(id: string, planId: string, offset = 0) {
    return getTaskRuns(this.taskJob(id), planId, offset);
  }

  private launchReserved(job: Job) {
    this.taskScheduler.cancel(job.view.id);
    job.view.status = 'running';
    job.abort = new AbortController();
    job.done = this.execute(job, this.providers.get(job.view.providerId));
  }

  async createTaskPlan(id: string, value: unknown) {
    this.assertWritable(id);
    if (this.planStorageFailed)
      throw new ManagementError('计划存档失败，请修复存储后重启。', 503);
    const job = this.taskJob(id);
    const requestId = object(value).requestId;
    if (
      requestId !== undefined &&
      (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(requestId))
    )
      throw new ManagementError('请求标识无效。');
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
      throw new ManagementError('请先让角色上线并结束或暂停当前执行。', 409);
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
      () => this.save(),
      (j) => this.schedule(j),
      draft.timing.kind === 'immediate',
    );
    if (runId) this.launchReserved(job);
    this.planScheduler.start();
    return structuredClone(plan);
  }

  private changingPlans = new Set<string>();

  private async commitPlan<T>(planId: string, change: () => T) {
    if (this.planStorageFailed)
      throw new ManagementError('计划存档失败，请修复存储后重启。', 503);
    const bound = this.plans.get(planId).agentId;
    if (
      this.changingPlans.has(planId) ||
      (bound && this.jobs.get(bound)?.taskMutating)
    )
      throw new ManagementError('计划正在提交，请稍后重试。', 409);
    this.changingPlans.add(planId);
    const before = structuredClone(this.plans.get(planId));
    try {
      const value = change();
      await this.save();
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
    if (plan.state === 'archived')
      throw new ManagementError('已归档任务不能修改。');
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
    if (!target) throw new ManagementError('请先指派执行角色。', 409);
    return executeTaskPlanControl(
      this.taskJob(target),
      planId,
      operation,
      value,
      () => this.save(),
      (j) => this.schedule(j),
      (j) => this.launchReserved(j),
    );
  }

  async controlTaskRun(
    id: string,
    runId: string,
    operation: string,
    value: unknown = {},
  ) {
    const job = this.taskJob(id);
    return executeTaskRunControl(
      job,
      runId,
      operation,
      value,
      this.providers.get(job.view.providerId),
      () => this.save(),
      (j) => this.schedule(j),
      (j) => this.launchReserved(j),
      (op) => this.controlTask(id, op),
    );
  }

  async dispatchDue(now = Date.now()) {
    if (this.closing || this.planStorageFailed) return;
    for (const job of this.jobs.values()) {
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
          () => this.save(),
          (j) => this.schedule(j),
          !skip,
        );
        if (runId) {
          selected = true;
          this.launchReserved(job);
        }
      }
    }
  }

  async models(id: string) {
    if (this.probing.has(id))
      throw new ManagementError('正在连接此模型服务，请稍候。', 429);
    const provider = this.providers.get(id);
    if (provider.type !== 'ollama' && !provider.apiKey)
      throw new ManagementError('请先配置 API Key。');
    this.probing.add(id);
    try {
      return await this.dependencies.models(provider);
    } catch {
      throw new ManagementError(
        '无法获取模型列表，请检查地址、密钥和服务状态。支持的模型 ID 也可手动填写。',
        502,
      );
    } finally {
      this.probing.delete(id);
    }
  }

  create(value: unknown) {
    if (this.closing) throw new ManagementError('世界服务正在关闭。', 503);
    const provider = this.providers.get(
      text(object(value).providerId, '模型服务', 80),
    );
    const settings = validateAgent(value, provider);
    const startTask = boolean(object(value).startTask, true);
    const joinWorld = boolean(object(value).joinWorld, true);
    if (startTask && !joinWorld)
      throw new ManagementError('立即任务需要加入世界。');
    if (startTask && !settings.goal)
      throw new ManagementError('请填写任务目标，或选择加入世界待命。');
    const firstTask = startTask
      ? validatePlan({
          name: settings.goal.slice(0, 80),
          goal: settings.goal,
          timing: { kind: 'immediate' },
          timeZone: object(value).taskTimeZone ?? 'UTC',
          limits: {
            maxTurns: settings.maxTurns,
            tokenBudget: settings.tokenBudget,
            taskTimeoutMs: settings.taskTimeoutMs,
          },
        })
      : undefined;
    this.checkVoice(settings);
    if (joinWorld && [...this.jobs.values()].filter(resident).length >= 4)
      throw new ManagementError(
        '最多同时在线 4 个受管理的 Agent（含待命），请先关闭一个。',
        409,
      );
    if (this.jobs.size >= 50)
      throw new ManagementError(
        '最多保存 50 个 Agent；为保留任务历史，不能自动删除旧角色。',
        409,
      );
    const job: Job = {
      view: {
        ...settings,
        id: randomUUID(),
        providerName: provider.name,
        status: joinWorld ? 'joining' : 'stopped',
        createdAt: Date.now(),
        logs: [],
      },
      abort: new AbortController(),
      memory: startTask ? { task: newTask(settings.goal) } : {},
      ledger: this.plans,
      attention: new AgentAttention(),
    };
    if (firstTask) {
      const plan = {
        ...newPlan(firstTask, job.view.createdAt),
        agentId: job.view.id,
        agentName: job.view.name,
      };
      const run = newRun(plan, job.view.createdAt, 'manual');
      run.task = job.memory.task;
      job.ledger.plans.push(plan);
      job.ledger.runs.push(run);
      job.currentRunId = run.id;
    }
    this.jobs.set(job.view.id, job);
    captureTask(job);
    const createdRun = currentRun(job);
    if (createdRun) createdRun.source = 'manual';
    this.planScheduler.start();
    if (joinWorld) job.done = this.execute(job, provider, startTask);
    this.persist();
    return this.list().find((v) => v.id === job.view.id)!;
  }

  join(id: string) {
    if (this.closing) throw new ManagementError('世界服务正在关闭。', 503);
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (resident(job) || job.updating || job.controlling || job.taskMutating)
      throw new ManagementError('角色已在线或正在更新，请稍候。', 409);
    if ([...this.jobs.values()].filter(resident).length >= 4)
      throw new ManagementError(
        '最多同时在线 4 个 Agent，请先让一个角色离开世界。',
        409,
      );
    const provider = this.providers.get(job.view.providerId);
    const settings = validateAgent(job.view, provider);
    this.checkVoice(settings);
    this.taskScheduler.cancel(job.view.id);
    // Joining is a presence action: it must never resume a previous task.
    if (
      job.memory.task &&
      ['running', 'waiting', 'paused'].includes(job.memory.task.status)
    ) {
      job.memory.task.status = 'paused';
      job.memory.task.reason = '已加入世界待命，任务进度保留。';
    }
    Object.assign(job.view, settings, {
      providerName: provider.name,
      status: 'joining',
    });
    job.attention.clear();
    job.abort = new AbortController();
    job.done = this.execute(job, provider, false);
    this.persist();
    return this.list().find((v) => v.id === id)!;
  }

  resume(id: string, value: unknown = {}) {
    if (this.closing) throw new ManagementError('世界服务正在关闭。', 503);
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (
      active(job.view.status) ||
      job.updating ||
      job.controlling ||
      job.taskMutating
    )
      throw new ManagementError('Agent 正在运行或关闭，请稍候。', 409);
    const input = object(value);
    if (job.memory.audienceExpired && input.goal === undefined)
      throw new ManagementError(
        '原私聊会话已失效，请重新通过聊天发起，避免向错误的玩家发送进展。',
        409,
      );
    const provider = this.providers.get(job.view.providerId);
    const settings = validateAgent(
      {
        ...job.view,
        goal: input.goal ?? job.memory.task?.goal ?? job.view.goal,
        ...taskLimits(input),
      },
      provider,
    );
    if (!settings.goal) throw new ManagementError('请先布置任务。');
    this.checkVoice(settings);
    if (!job.session && [...this.jobs.values()].filter(resident).length >= 4)
      throw new ManagementError('最多同时在线 4 个 Agent，请先关闭一个。', 409);
    this.taskScheduler.cancel(job.view.id);
    captureTask(job);
    if (
      input.goal !== undefined ||
      !job.memory.task ||
      ['completed', 'cancelled'].includes(job.memory.task.status)
    ) {
      const previousRun = currentRun(job);
      const previousPlan = job.ledger.plans.find(
        (p) => p.id === previousRun?.planId,
      );
      if (input.goal === undefined && previousPlan) {
        if (previousPlan.state === 'archived')
          throw new ManagementError('任务已归档，请创建新任务。');
        if (
          hasPlanTokenLimit(previousPlan) &&
          previousPlan.spentTokens >= previousPlan.totalTokenBudget
        )
          throw new ManagementError('请先追加计划累计额度。');
        reserveRun(job, previousPlan, 'manual', Date.now());
      } else {
        const plan = {
          ...newPlan(
            validatePlan({
              name: settings.goal.slice(0, 80),
              goal: settings.goal,
              timing: { kind: 'immediate' },
              timeZone: 'UTC',
              limits: settings,
            }),
            Date.now(),
          ),
          agentId: id,
          agentName: job.view.name,
        };
        this.plans.plans.push(plan);
        reserveRun(job, plan, 'manual', Date.now());
      }
    } else {
      const task = job.memory.task;
      if (
        currentRun(job)?.snapshot.limits.enabled !== false &&
        (task.calls >= settings.maxTurns ||
          task.tokens >= settings.tokenBudget! ||
          task.elapsedMs >= settings.taskTimeoutMs!)
      )
        throw new ManagementError('请增加本次执行的总额度后再继续。');
      new TaskService(job.memory).command(
        { type: 'resume' },
        { kind: 'operator' },
        {
          ...settings,
          ...(currentRun(job)?.snapshot.limits.enabled === false
            ? {
                maxTurns: Infinity,
                tokenBudget: Infinity,
                taskTimeoutMs: Infinity,
              }
            : {}),
          apiKey: '',
        },
      );
    }
    const resumedRecord = currentRun(job);
    if (resumedRecord)
      resumedRecord.snapshot.limits = {
        enabled: resumedRecord.snapshot.limits.enabled,
        maxTurns: settings.maxTurns,
        tokenBudget: settings.tokenBudget!,
        taskTimeoutMs: settings.taskTimeoutMs!,
      };
    Object.assign(job.view, settings, {
      providerName: provider.name,
      status: job.session ? 'running' : 'joining',
    });
    job.abort = new AbortController();
    job.done = this.execute(job, provider);
    this.persist();
    return this.list().find((v) => v.id === job.view.id)!;
  }

  async update(id: string, value: unknown) {
    if (this.closing) throw new ManagementError('世界服务正在关闭。', 503);
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (
      active(job.view.status) ||
      job.updating ||
      job.controlling ||
      job.taskMutating
    )
      throw new ManagementError('请等待 Agent 待命，或关闭后再修改参数。', 409);
    const input = object(value);
    const provider = this.providers.get(
      text(input.providerId, '模型服务', 80, job.view.providerId),
    );
    const currentGoal = job.memory.task?.goal ?? job.view.goal;
    const settings = validateAgent(
      {
        ...job.view,
        goal: currentGoal,
        ...input,
        permissions:
          input.permissions !== undefined
            ? input.permissions
            : input.allowEdits !== undefined
              ? undefined
              : job.view.permissions,
      },
      provider,
    );
    this.checkVoice(settings);
    const replacementDraft =
      settings.goal !== currentGoal && settings.goal
        ? validatePlan({
            name: settings.goal.slice(0, 80),
            goal: settings.goal,
            timing: { kind: 'immediate' },
            timeZone: 'UTC',
            limits: settings,
          })
        : undefined;
    job.updating = true;
    try {
      const session = job.session;
      if (
        session &&
        (!!settings.voiceReplies && agentPermissions(settings).chat) !==
          (!!job.view.voiceReplies && agentPermissions(job.view).chat)
      ) {
        const result = await session.request('agent.voice', {
          enabled: !!settings.voiceReplies && agentPermissions(settings).chat,
        });
        if (!result.ok || job.session !== session || active(job.view.status))
          throw new ManagementError('语音开关未保存，请刷新后重试。', 409);
      }
      if (session && settings.name !== job.view.name) {
        const result = await session.request('rename', { name: settings.name });
        if (!result.ok || job.session !== session || active(job.view.status))
          throw new ManagementError(
            '角色状态已变化，未保存参数，请刷新后重试。',
            409,
          );
      }
      if (settings.goal !== currentGoal) {
        this.taskScheduler.cancel(job.view.id);
        if (
          job.memory.task &&
          !['completed', 'cancelled'].includes(job.memory.task.status)
        )
          new TaskService(job.memory).command(
            { type: 'pause' },
            { kind: 'operator' },
            { ...job.view, apiKey: '' },
          );
        captureTask(job);
        delete job.currentRunId;
        job.memory = { usage: job.memory.usage };
        // Legacy profile goal edits are explicit administrative assignments.
        // Keep them in the plan domain instead of inventing a chat execution.
        if (replacementDraft) {
          const plan = {
            ...newPlan(replacementDraft, Date.now()),
            agentId: id,
            agentName: settings.name,
          };
          plan.state = 'paused';
          delete plan.nextRunAt;
          this.plans.plans.push(plan);
          reserveRun(job, plan, 'manual', Date.now());
          currentRun(job)!.agentName = settings.name;
          new TaskService(job.memory).command(
            { type: 'pause' },
            { kind: 'operator' },
            { ...settings, apiKey: '' },
          );
          job.memory.task!.reason = '目标已修改，等待继续。';
        }
        job.attention.clear();
      } else if (
        settings.providerId !== job.view.providerId ||
        settings.model !== job.view.model
      ) {
        this.taskScheduler.cancel(job.view.id);
        if (
          job.memory.task &&
          !['completed', 'cancelled'].includes(job.memory.task.status)
        ) {
          new TaskService(job.memory).command(
            { type: 'pause' },
            { kind: 'operator' },
            { ...settings, apiKey: '' },
          );
          job.memory.task.reason = '模型已修改，进度已保留，请确认后继续。';
        }
        if (job.memory.pi?.inFlight)
          job.memory.unknownEffect = {
            ...job.memory.pi.inFlight,
            state: 'unknown',
          };
        delete job.memory.pi;
        job.attention.clear();
      } else if (
        JSON.stringify(agentPermissions(settings)) !==
          JSON.stringify(agentPermissions(job.view)) ||
        JSON.stringify(settings.skills) !== JSON.stringify(job.view.skills)
      ) {
        this.taskScheduler.cancel(job.view.id);
        job.attention.clear();
        if (
          job.memory.task &&
          !['completed', 'cancelled'].includes(job.memory.task.status)
        ) {
          new TaskService(job.memory).command(
            { type: 'pause' },
            { kind: 'operator' },
            { ...settings, apiKey: '' },
          );
          job.memory.task.reason =
            '角色技能或动作权限已修改，进度已保留，请确认后继续。';
        }
        appendAgentLog(
          job.view,
          '角色能力已更新；后续按新权限重新规划，已有进度保留。',
        );
      }
      Object.assign(job.view, settings, { providerName: provider.name });
      this.bindVoice(job);
      await this.save();
      return this.list().find((v) => v.id === job.view.id)!;
    } finally {
      job.updating = false;
      this.schedule(job);
    }
  }

  async setVoice(id: string, value: unknown) {
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (
      this.closing ||
      job.updating ||
      job.taskMutating ||
      job.controlling ||
      ['joining', 'stopping'].includes(job.view.status)
    )
      throw new ManagementError('Agent 状态正在更新，请稍候。', 409);
    const enabled = boolean(object(value).enabled, false);
    if (enabled && !agentPermissions(job.view).chat)
      throw new ManagementError('发送聊天权限已关闭，不能开启语音回复。');
    this.checkVoice({ ...job.view, voiceReplies: enabled });
    job.updating = true;
    try {
      if (job.session?.room) {
        const result = await job.session.request('agent.voice', { enabled });
        if (!result.ok)
          throw new ManagementError('语音开关未生效，请重试。', 409);
      }
      job.view.voiceReplies = enabled;
      this.bindVoice(job);
      await this.save();
      return this.list().find((v) => v.id === job.view.id)!;
    } finally {
      job.updating = false;
      this.schedule(job);
    }
  }

  private wake(job: Job) {
    if (
      this.closing ||
      job.storageFailed ||
      job.controlling ||
      job.updating ||
      job.taskMutating ||
      (job.view.status !== 'idle' &&
        !(job.view.status === 'failed' && job.attention.pending)) ||
      !job.session
    )
      return;
    this.taskScheduler.cancel(job.view.id);
    job.view.status = 'running';
    job.abort = new AbortController();
    job.done = this.execute(job, this.providers.get(job.view.providerId));
  }

  private schedule(job: Job) {
    this.taskScheduler.cancel(job.view.id);
    if (
      this.closing ||
      job.storageFailed ||
      job.controlling ||
      job.updating ||
      job.taskMutating ||
      (job.view.status !== 'idle' &&
        !(job.view.status === 'failed' && job.attention.pending)) ||
      !job.session
    )
      return;
    if (job.attention.pending) {
      this.taskScheduler.wake(job.view.id, 0, () => this.wake(job));
    } else if (['running', 'waiting'].includes(job.memory.task?.status ?? '')) {
      this.taskScheduler.wake(
        job.view.id,
        job.memory.follow ? 100 : nextIntervalMs(job.view),
        () => this.wake(job),
      );
    }
  }

  async controlTask(id: string, operation: 'pause' | 'cancel') {
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (
      this.closing ||
      job.updating ||
      job.taskMutating ||
      job.controlling ||
      ['joining', 'stopping'].includes(job.view.status)
    )
      throw new ManagementError('Agent 状态正在更新，请稍候。', 409);
    const taskEnded = () =>
      !!job.memory.task &&
      ['completed', 'cancelled'].includes(job.memory.task.status);
    // Repeated controls on an ended task are idempotent. An active reply can
    // still be interrupted, but must not rewrite the task it follows.
    if (taskEnded() && !active(job.view.status)) {
      await this.saving;
      return this.list().find((v) => v.id === id)!;
    }
    job.controlling = true;
    this.taskScheduler.cancel(job.view.id);
    job.attention.clear();
    job.abort.abort();
    try {
      await job.done;
      // Completion can win while the in-flight runner settles after abort.
      // Recheck here rather than relying on the status at request admission.
      if (job.memory.task && !taskEnded()) {
        new TaskService(job.memory).command(
          { type: operation },
          { kind: 'operator' },
          { ...job.view, apiKey: '' },
        );
      }
      if (job.session) job.view.status = 'idle';
      await this.save();
      return this.list().find((v) => v.id === id)!;
    } finally {
      job.controlling = false;
    }
  }

  async assignTask(id: string, value: unknown) {
    const input = object(value);
    const goal = text(input.goal, '任务目标', 2000);
    if (!goal) throw new ManagementError('请填写任务目标。');
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    const limits = taskLimits(input);
    validateAgent(
      { ...job.view, ...limits, goal },
      this.providers.get(job.view.providerId),
    );
    await this.controlTask(id, 'pause');
    return this.resume(id, { goal, ...limits });
  }

  private async execute(job: Job, provider: SavedProvider, run = true) {
    if (job.storageFailed) {
      job.view.status = 'failed';
      return;
    }
    const ctx: ExecutionContext = {
      serverUrl:
        typeof this.serverUrl === 'string' ? this.serverUrl : this.serverUrl(),
      dependencies: this.dependencies,
      voiceServices: this.voiceServices,
      closing: () => this.closing,
      bindVoice: (j) => this.bindVoice(j),
      controlTask: (targetId, op, identity, commandId) =>
        this.dispatch(
          `tasks.${op}`,
          { agentId: targetId, expectedTask: identity },
          commandId,
        ),
      wake: (j) => this.wake(j),
      schedule: (j) => this.schedule(j),
      save: () => this.save(),
      persist: () => this.persist(),
    };
    job.host ??= new AgentHost(job, ctx);
    return job.host.run(provider, run);
  }

  stop(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (
      job.view.status !== 'stopping' &&
      (resident(job) || job.view.status !== 'stopped')
    ) {
      this.taskScheduler.cancel(job.view.id);
      job.view.status = 'stopping';
      job.attention.clear();
      job.abort.abort();
      const closed = job.session
        ?.close()
        .catch(() => job.session?.room?.connection.close());
      const previous = job.done;
      job.done = (async () => {
        await Promise.allSettled([previous, closed]);
        await job.session
          ?.close()
          .catch(() => job.session?.room?.connection.close());
        job.session = undefined;
        delete job.view.sessionId;
        job.view.status = 'stopped';
        if (
          job.memory.task &&
          ['running', 'waiting'].includes(job.memory.task.status)
        ) {
          new TaskService(job.memory).command(
            { type: 'pause' },
            { kind: 'operator' },
            { ...job.view, apiKey: '' },
          );
          job.memory.task.reason = '角色已离开世界，任务进度已保留。';
        }
        this.persist();
      })();
    }
    return this.list().find((v) => v.id === job.view.id)!;
  }
  async remove(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (this.closing || job.updating || job.taskMutating || job.controlling)
      throw new ManagementError('Agent 状态正在更新，请稍候。', 409);
    // Block scheduling and mutations until all in-flight effects have settled.
    job.controlling = true;
    try {
      this.stop(id);
      await job.done;
      captureTask(job);
      const priorPlans = structuredClone(
        this.plans.plans.filter((p) => p.agentId === id),
      );
      const priorRuns = structuredClone(
        this.plans.runs.filter((r) => r.agentId === id),
      );
      for (const run of this.plans.runs.filter(
        (r) => r.agentId === id && !endedRun(r),
      )) {
        if (run.runtime?.task) {
          new TaskService(run.runtime).command(
            { type: 'cancel' },
            { kind: 'operator' },
            { ...job.view, apiKey: '' },
          );
          delete run.runtime.follow;
          run.task = structuredClone(run.runtime.task);
        }
        run.status = 'cancelled';
        run.reason = '执行角色已删除。';
        run.finishedAt = Date.now();
      }
      this.plans.detach(id, job.view.name);
      this.jobs.delete(id);
      this.persist();
      try {
        await this.saving;
      } catch (error) {
        // A failed archive write must leave a stopped, recoverable character.
        for (const p of priorPlans) {
          const idx = this.plans.plans.findIndex((x) => x.id === p.id);
          this.plans.plans[idx] = p;
        }
        this.plans.runs = [
          ...this.plans.runs.filter((r) => r.agentId !== id),
          ...priorRuns,
        ];
        this.jobs.set(id, job);
        this.persist();
        await this.saving.catch(() => {});
        throw error;
      }
    } finally {
      job.controlling = false;
    }
  }
  async removeProvider(id: string) {
    if ([...this.jobs.values()].some((j) => j.view.providerId === id))
      throw new ManagementError(
        '已有可复用 Agent 关联此模型服务，请保留配置或更新其密钥。',
        409,
      );
    await this.providers.remove(id);
  }

  async removeVoiceService(id: string) {
    if (!this.voiceServices) throw new ManagementError('语音服务未就绪。', 503);
    await this.voiceServices.remove(id, () =>
      [...this.jobs.values()].some(
        (j) => j.updating || j.view.voiceServiceId === id,
      ),
    );
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.shutdown());
  }

  private async shutdown() {
    this.taskScheduler.close();
    this.planScheduler.close();
    this.closing = true;
    for (const job of this.jobs.values()) {
      this.shutdownPresence.set(job.view.id, job.view.status);
      if (['running', 'waiting'].includes(job.memory.task?.status ?? '')) {
        const run = currentRun(job),
          plan = job.ledger.plans.find((p) => p.id === run?.planId);
        if (plan) {
          plan.state = 'paused';
          plan.reason = '服务关闭，进度保留，请手动继续。';
          delete plan.nextRunAt;
        }
      }
    }
    for (const id of this.jobs.keys()) this.stop(id);
    await Promise.allSettled([...this.jobs.values()].map((j) => j.done));
    await this.save();
    this.events.close();
  }
}

export type GatewayDependencies = {
  session: (url: string) => Session;
  runner: (
    config: AgentConfig,
    provider: SavedProvider,
  ) => Pick<AgentRunner, 'run'>;
  models: (provider: SavedProvider) => Promise<string[]>;
};

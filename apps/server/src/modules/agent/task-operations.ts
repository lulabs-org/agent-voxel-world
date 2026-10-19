import {
  hasPlanTokenLimit,
  isRepeating,
  type TaskPlan,
  type TaskRun,
} from '@voxel/shared';
import { endedRun, newRun, nextOccurrence, runView } from '../tasks/plans/model';
import { newTask, TaskService } from '@voxel/agent-runtime';
import { object } from '../../common/validation';
import { taskLimits, validateAgent } from './agent-validation';
import type { SavedProvider } from '../providers/provider-validation';
import { AppError } from '../../common/errors';
import { active, type Job } from './types';

export function currentRun(job: Job) {
  return job.ledger.runs.find((r) => r.id === job.currentRunId);
}

export function taskBusy(job: Job) {
  const run = currentRun(job);
  return (
    !!job.taskMutating ||
    job.updating ||
    job.controlling ||
    active(job.view.status) ||
    (!!run &&
      ['running', 'waiting'].includes(run.status) &&
      job.view.status !== 'failed')
  );
}

export function captureTask(job: Job) {
  if (!job.memory.task) return;
  new TaskService(job.memory).lease();
  let run = currentRun(job);
  if (!run || (run.task && run.task.startedAt !== job.memory.task.startedAt)) {
    const snapshot = {
      name: job.memory.task.goal.slice(0, 80) || '聊天执行',
      goal: job.memory.task.goal,
      timing: { kind: 'immediate' as const },
      timeZone: 'UTC',
      limits: {
        maxTurns: job.view.maxTurns,
        tokenBudget: job.view.tokenBudget ?? 50000,
        taskTimeoutMs: job.view.taskTimeoutMs ?? 900000,
      },
      totalTokenBudget: 500000,
    };
    run = newRun(
      {
        ...snapshot,
        id: '',
        createdAt: job.memory.task.startedAt,
        updatedAt: job.memory.task.startedAt,
        state: 'enabled',
        reason: '',
        spentTokens: 0,
      },
      job.memory.task.startedAt,
      'chat',
    );
    delete run.planId;
    run.agentId = job.view.id;
    run.agentName = job.view.name;
    run.logs = [...job.view.logs];
    job.ledger.runs.push(run);
    job.currentRunId = run.id;
  }
  const plan = job.ledger.plans.find((p) => p.id === run!.planId);
  const task = job.memory.task;
  const delta = Math.max(0, task.tokens - run.accountedTokens);
  run.totalTokens += delta;
  if (plan) plan.spentTokens += delta;
  run.accountedTokens = task.tokens;
  const batch = job.memory.previous as
    | {
        batchId?: string;
        results?: {
          action?: { type?: string };
          status?: string;
          result?: unknown;
        }[];
      }
    | undefined;
  if (
    Array.isArray(batch?.results) &&
    JSON.stringify(batch) !== run.lastBatch
  ) {
    run.lastBatch = JSON.stringify(batch);
    const call = job.memory.usage?.calls ?? task.calls;
    run.actions ??= [];
    batch.results.forEach((result, index) => {
      if (!result.action?.type || !result.status) return;
      const entry = {
        batchId: batch.batchId,
        call,
        index,
        kind: result.action.type,
        status: result.status,
        detail: JSON.stringify({
          action: result.action,
          result: result.result,
        }),
      };
      const existing = run!.actions!.findIndex(
        (a) =>
          a.call === call && a.index === index && a.batchId === batch.batchId,
      );
      if (existing < 0) run!.actions!.push(entry);
      else run!.actions![existing] = entry;
    });
  }
  run.task = structuredClone(task);
  const { usage, ...runtime } = job.memory;
  run.runtime = structuredClone(runtime);
  run.startedAt ??= task.startedAt;
  run.status =
    job.view.status === 'failed' &&
    !['completed', 'cancelled', 'budget'].includes(task.status)
      ? 'failed'
      : task.status;
  run.reason =
    run.status === 'failed'
      ? job.view.logs.at(-1) || '执行中断，请检查后继续。'
      : task.reason;
  if (endedRun(run)) run.finishedAt ??= Date.now();
  // Historical results still contribute usage, but cannot overwrite newer plan controls.
  if (
    !plan ||
    plan.agentId !== run.agentId ||
    plan.revision !== run.planRevision
  )
    return;
  const beforePlan = JSON.stringify(plan);
  if (['failed', 'budget', 'needs_input', 'blocked'].includes(run.status)) {
    plan.state = 'paused';
    plan.reason = run.reason || '本次执行需要处理。';
    delete plan.nextRunAt;
  } else if (
    endedRun(run) &&
    !isRepeating(plan.timing) &&
    plan.state === 'enabled' &&
    !plan.nextRunAt
  )
    plan.state = 'completed';
  if (
    hasPlanTokenLimit(plan) &&
    plan.spentTokens >= plan.totalTokenBudget &&
    plan.state !== 'archived'
  ) {
    plan.state = 'paused';
    plan.reason = '计划累计 token 额度已用尽，请追加额度后恢复。';
    delete plan.nextRunAt;
  }
  if (beforePlan !== JSON.stringify(plan)) job.ledger.touch(plan);
}

export async function commitExecution<T>(
  job: Job,
  change: () => T,
  save: () => Promise<void>,
  schedule: (job: Job) => void,
  swapsExecution = false,
): Promise<T> {
  if (job.taskMutating || job.updating || job.controlling)
    throw new AppError('任务状态正在更新，请稍候。', 409);
  captureTask(job);
  const before = {
    plans: structuredClone(
      job.ledger.plans.filter((p) => p.agentId === job.view.id),
    ),
    runs: structuredClone(
      job.ledger.runs.filter((r) => r.agentId === job.view.id),
    ),
    currentRunId: job.currentRunId,
    requests: Object.fromEntries(
      Object.entries(job.ledger.requests).filter(([k]) =>
        k.startsWith(job.view.id + ':'),
      ),
    ),
    memory: structuredClone(job.memory),
    view: structuredClone(job.view),
  };
  job.taskMutating = true;
  try {
    const result = change();
    await save();
    return result;
  } catch (error) {
    job.ledger.plans = [
      ...job.ledger.plans.filter((p) => p.agentId !== job.view.id),
      ...before.plans,
    ];
    job.ledger.runs = [
      ...job.ledger.runs.filter((r) => r.agentId !== job.view.id),
      ...before.runs,
    ];
    job.ledger.requests = {
      ...Object.fromEntries(
        Object.entries(job.ledger.requests).filter(
          ([k]) => !k.startsWith(job.view.id + ':'),
        ),
      ),
      ...before.requests,
    };
    job.currentRunId = before.currentRunId;
    if (swapsExecution) {
      job.memory = before.memory;
      job.view = before.view;
    } else captureTask(job);
    throw error;
  } finally {
    job.taskMutating = false;
    schedule(job);
  }
}

export function getTaskPlans(job: Job) {
  captureTask(job);
  return job.ledger.views(job.view.id);
}
export function getTaskRuns(job: Job, planId: string, offset = 0) {
  captureTask(job);
  job.ledger.assertBinding(planId, job.view.id);
  return job.ledger.history(planId, offset);
}

export function reserveRun(
  job: Job,
  plan: TaskPlan,
  source: TaskRun['source'],
  at: number,
  skip?: string,
) {
  if (
    source === 'scheduled' &&
    job.ledger.runs.some(
      (r) =>
        r.planId === plan.id &&
        r.planRevision === (plan.revision ?? 1) &&
        r.source === source &&
        r.scheduledAt === at,
    )
  )
    return undefined;
  captureTask(job);
  const run = newRun({ ...plan, agentName: job.view.name }, at, source);
  job.ledger.runs.push(run);
  if (skip) {
    run.status = isRepeating(plan.timing) ? 'skipped' : 'missed';
    run.reason = skip;
    run.finishedAt = Date.now();
    if (!isRepeating(plan.timing)) plan.state = 'completed';
    return undefined;
  }
  const task = newTask(plan.goal);
  run.task = task;
  run.runtime = { task };
  run.startedAt = task.startedAt;
  job.currentRunId = run.id;
  job.memory = { task, usage: job.memory.usage };
  job.view.status = 'idle';
  Object.assign(job.view, plan.limits, { goal: plan.goal });
  return run.id;
}

export async function executeTaskPlanControl(
  job: Job,
  planId: string,
  operation: string,
  value: unknown,
  save: () => Promise<void>,
  schedule: (job: Job) => void,
  launch: (job: Job) => void,
) {
  const plan = job.ledger.plans.find((p) => p.id === planId);
  if (!plan) throw new AppError('任务不存在。', 404);
  if (plan.state === 'archived') throw new AppError('任务已归档。');
  job.ledger.assertBinding(planId, job.view.id);
  if (operation === 'run') {
    const requestId = object(value).requestId;
    if (
      typeof requestId !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(requestId)
    )
      throw new AppError('执行请求标识无效。');
    const prior = job.ledger.runs.find(
      (r) => r.planId === planId && r.requestId === requestId,
    );
    if (prior) return runView(prior);
    if (job.ledger.unfinished(planId))
      throw new AppError('请先结束该计划的未完成执行。', 409);
    if (!job.session || taskBusy(job))
      throw new AppError(
        '角色离线或忙碌，请先上线或暂停当前执行。',
        409,
      );
    if (hasPlanTokenLimit(plan) && plan.spentTokens >= plan.totalTokenBudget)
      throw new AppError('请先追加计划累计额度。');
    let runId: string | undefined;
    await commitExecution(
      job,
      () => {
        runId = reserveRun(job, plan, 'manual', Date.now());
        currentRun(job)!.requestId = requestId;
      },
      save,
      schedule,
      true,
    );
    if (runId) launch(job);
    return runView(currentRun(job)!);
  }
  return commitExecution(
    job,
    () => {
      return job.ledger.control(planId, operation, value);
    },
    save,
    schedule,
  );
}

export async function executeTaskRunControl(
  job: Job,
  runId: string,
  operation: string,
  value: unknown,
  provider: SavedProvider,
  save: () => Promise<void>,
  schedule: (job: Job) => void,
  launch: (job: Job) => void,
  controlCurrentTask: (op: 'pause' | 'cancel') => Promise<unknown>,
) {
  captureTask(job);
  const run = job.ledger.runs.find((r) => r.id === runId);
  if (!run || run.agentId !== job.view.id || !run.runtime?.task)
    throw new AppError('执行记录不存在或不可继续。', 404);
  if (endedRun(run)) throw new AppError('执行已结束，请重新执行任务。');
  if (operation === 'pause' || operation === 'cancel') {
    if (job.currentRunId === runId) return controlCurrentTask(operation);
    return commitExecution(
      job,
      () => {
        new TaskService(run.runtime!).command(
          { type: operation },
          { kind: 'operator' },
          { ...job.view, apiKey: '' },
        );
        run.runtime!.task!.reason =
          '已由玩家' + (operation === 'cancel' ? '结束。' : '暂停。');
        run.task = structuredClone(run.runtime!.task);
        run.status = run.task!.status;
        run.reason = run.task!.reason;
        if (operation === 'cancel') {
          run.finishedAt = Date.now();
          delete run.runtime!.follow;
        }
        return runView(run);
      },
      save,
      schedule,
    );
  }
  if (operation !== 'resume') throw new AppError('执行操作无效。');
  if (!job.session || taskBusy(job))
    throw new AppError('角色离线或忙碌，请先上线或暂停当前执行。', 409);
  if (run.runtime.audienceExpired)
    throw new AppError('原私聊会话已失效，请重新通过聊天发起。', 409);
  const plan = job.ledger.plans.find((p) => p.id === run.planId);
  if (
    plan &&
    hasPlanTokenLimit(run.snapshot) &&
    plan.spentTokens >= plan.totalTokenBudget
  )
    throw new AppError('请先追加计划累计额度。');
  const enabled = run.snapshot.limits.enabled !== false;
  const settings = validateAgent(
    { ...job.view, ...run.snapshot.limits, ...taskLimits(object(value)) },
    provider,
  );
  if (
    enabled &&
    (settings.maxTurns <= run.task!.calls ||
      settings.tokenBudget! <= run.task!.tokens ||
      settings.taskTimeoutMs! <= run.task!.elapsedMs)
  )
    throw new AppError('继续执行的额度必须大于已使用额度。');
  await commitExecution(
    job,
    () => {
      captureTask(job);
      run.snapshot.limits = {
        enabled,
        maxTurns: settings.maxTurns,
        tokenBudget: settings.tokenBudget!,
        taskTimeoutMs: settings.taskTimeoutMs!,
      };
      job.memory = {
        ...structuredClone(run.runtime!),
        usage: job.memory.usage,
      };
      new TaskService(job.memory).command(
        { type: 'resume' },
        { kind: 'operator' },
        {
          ...settings,
          ...(!enabled
            ? {
                maxTurns: Infinity,
                tokenBudget: Infinity,
                taskTimeoutMs: Infinity,
              }
            : {}),
          apiKey: '',
        },
      );
      job.currentRunId = run.id;
      Object.assign(job.view, run.snapshot.limits, {
        goal: run.snapshot.goal,
      });
      run.status = 'running';
      job.view.status = 'idle';
      delete run.finishedAt;
    },
    save,
    schedule,
    true,
  );
  launch(job);
  return runView(run);
}

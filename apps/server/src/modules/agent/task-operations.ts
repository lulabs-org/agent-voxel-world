import {
  hasPlanTokenLimit,
  isRepeating,
  type TaskPlan,
  type TaskRun,
} from '@voxel/shared';
import {
  endedRun,
  newPlan,
  newRun,
  nextOccurrence,
  runView,
} from './scheduler';
import { newTask } from '@voxel/agent-runtime';
import {
  integer,
  object,
  taskLimits,
  validateAgent,
  type SavedProvider,
} from './validation';
import { ManagementError } from './errors';
import { active, type Job } from './types';

export function currentRun(job: Job) {
  return job.book.runs.find((r) => r.id === job.book.currentRunId);
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
  let run = currentRun(job);
  if (!run || (run.task && run.task.startedAt !== job.memory.task.startedAt)) {
    const p = newPlan(
      {
        name: job.memory.task.goal.slice(0, 80) || '任务',
        goal: job.memory.task.goal,
        timing: { kind: 'immediate' },
        timeZone: 'UTC',
        limits: {
          maxTurns: job.view.maxTurns,
          tokenBudget: job.view.tokenBudget ?? 50000,
          taskTimeoutMs: job.view.taskTimeoutMs ?? 900000,
        },
        totalTokenBudget: 500000,
      },
      job.memory.task.startedAt,
    );
    job.book.plans.push(p);
    run = newRun(p, p.createdAt, 'legacy');
    run.logs = [...job.view.logs];
    job.book.runs.push(run);
    job.book.currentRunId = run.id;
  }
  const plan = job.book.plans.find((p) => p.id === run!.planId)!;
  const task = job.memory.task;
  const delta = Math.max(0, task.tokens - run.accountedTokens);
  run.totalTokens += delta;
  plan.spentTokens += delta;
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
}

export async function commitTaskBook<T>(
  job: Job,
  change: () => T,
  save: () => Promise<void>,
  schedule: (job: Job) => void,
  swapsExecution = false,
): Promise<T> {
  if (job.taskMutating || job.updating || job.controlling)
    throw new ManagementError('任务状态正在更新，请稍候。', 409);
  captureTask(job);
  const before = {
    book: structuredClone(job.book),
    memory: structuredClone(job.memory),
    view: structuredClone(job.view),
  };
  job.taskMutating = true;
  try {
    const result = change();
    await save();
    return result;
  } catch (error) {
    job.book = before.book;
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
  return job.book.plans.map((p) => ({
    ...structuredClone(p),
    latestRun: (() => {
      const run = job.book.runs.filter((r) => r.planId === p.id).at(-1);
      return run
        ? { ...runView(run), actions: undefined, logs: [] }
        : undefined;
    })(),
  }));
}

export function getTaskRuns(job: Job, planId: string, offset = 0) {
  captureTask(job);
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new ManagementError('分页参数无效。');
  if (!job.book.plans.some((p) => p.id === planId))
    throw new ManagementError('任务不存在。', 404);
  const all = job.book.runs
    .filter((r) => r.planId === planId)
    .slice()
    .reverse();
  return {
    items: all.slice(offset, offset + 20).map(runView),
    active: all.filter((r) => !endedRun(r)).map(runView),
    total: all.length,
    nextOffset: offset + 20 < all.length ? offset + 20 : undefined,
  };
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
    job.book.runs.some(
      (r) =>
        r.planId === plan.id && r.source === source && r.scheduledAt === at,
    )
  )
    return undefined;
  captureTask(job);
  const run = newRun(plan, at, source);
  job.book.runs.push(run);
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
  job.book.currentRunId = run.id;
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
  const plan = job.book.plans.find((p) => p.id === planId);
  if (!plan) throw new ManagementError('任务不存在。', 404);
  if (plan.state === 'archived') throw new ManagementError('任务已归档。');
  if (operation === 'run') {
    const requestId = object(value).requestId;
    if (
      typeof requestId !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(requestId)
    )
      throw new ManagementError('执行请求标识无效。');
    const prior = job.book.runs.find(
      (r) => r.planId === planId && r.requestId === requestId,
    );
    if (prior) return runView(prior);
    if (!job.session || taskBusy(job))
      throw new ManagementError(
        '角色离线或忙碌，请先上线或暂停当前执行。',
        409,
      );
    if (hasPlanTokenLimit(plan) && plan.spentTokens >= plan.totalTokenBudget)
      throw new ManagementError('请先追加计划累计额度。');
    let runId: string | undefined;
    await commitTaskBook(
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
  return commitTaskBook(
    job,
    () => {
      if (operation === 'pause') {
        plan.state = 'paused';
        plan.reason = '计划已暂停，本次执行不受影响。';
        delete plan.nextRunAt;
      } else if (operation === 'resume') {
        if (!isRepeating(plan.timing) && plan.timing.kind !== 'once')
          throw new ManagementError('一次性任务请使用立即执行。');
        if (
          job.book.runs.some(
            (r) =>
              r.planId === planId &&
              ['failed', 'blocked', 'needs_input', 'budget'].includes(r.status),
          )
        )
          throw new ManagementError('请先处理或结束异常执行。');
        if (
          hasPlanTokenLimit(plan) &&
          plan.spentTokens >= plan.totalTokenBudget
        )
          throw new ManagementError('请先追加计划累计额度。');
        plan.nextRunAt = nextOccurrence(plan, Date.now());
        if (!plan.nextRunAt)
          throw new ManagementError(
            '指定时间已错过，请编辑未来时间或手动执行。',
          );
        plan.state = 'enabled';
        plan.reason = '';
      } else if (operation === 'archive') {
        if (job.book.runs.some((r) => r.planId === planId && !endedRun(r)))
          throw new ManagementError('请先结束所有未完成的执行。', 409);
        plan.state = 'archived';
        delete plan.nextRunAt;
      } else if (operation === 'extend') {
        const amount = integer(
          object(value).tokens,
          '追加 token 额度',
          0,
          1000,
          1000000000,
        );
        if (plan.totalTokenBudget + amount > 1000000000)
          throw new ManagementError('累计额度过大。');
        plan.totalTokenBudget += amount;
      } else throw new ManagementError('计划操作无效。');
      plan.updatedAt = Date.now();
      return structuredClone(plan);
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
  const run = job.book.runs.find((r) => r.id === runId);
  if (!run || !run.runtime?.task)
    throw new ManagementError('执行记录不存在或不可继续。', 404);
  if (endedRun(run)) throw new ManagementError('执行已结束，请重新执行任务。');
  if (operation === 'pause' || operation === 'cancel') {
    if (job.book.currentRunId === runId) return controlCurrentTask(operation);
    return commitTaskBook(
      job,
      () => {
        run.runtime!.task!.status =
          operation === 'cancel' ? 'cancelled' : 'paused';
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
  if (operation !== 'resume') throw new ManagementError('执行操作无效。');
  if (!job.session || taskBusy(job))
    throw new ManagementError('角色离线或忙碌，请先上线或暂停当前执行。', 409);
  if (run.runtime.audienceExpired)
    throw new ManagementError('原私聊会话已失效，请新建任务。', 409);
  const plan = job.book.plans.find((p) => p.id === run.planId)!;
  if (
    hasPlanTokenLimit(run.snapshot) &&
    plan.spentTokens >= plan.totalTokenBudget
  )
    throw new ManagementError('请先追加计划累计额度。');
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
    throw new ManagementError('继续执行的额度必须大于已使用额度。');
  await commitTaskBook(
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
      job.memory.task!.status = 'running';
      job.memory.task!.reason = '';
      job.memory.failures = 0;
      job.memory.noProgress = 0;
      job.book.currentRunId = run.id;
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

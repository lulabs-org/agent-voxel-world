import { TaskPlanError } from './errors';
import { nextOccurrence } from '@voxel/shared';
export { nextOccurrence, wallClockInstant } from '@voxel/shared';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_TASK_LIMITS,
  type TaskPlanDraft,
  type TaskPlan,
  type TaskRun,
  type TaskTiming,
} from '@voxel/shared';
import type { AgentRunState } from '@voxel/agent-runtime';

export type StoredRun = TaskRun & {
  runtime?: AgentRunState;
  accountedTokens: number;
  requestId?: string;
  lastBatch?: string;
};
export type TaskBook = {
  version: 1;
  plans: TaskPlan[];
  runs: StoredRun[];
  currentRunId?: string;
  requests?: Record<string, string>;
};
export const emptyTaskBook = (): TaskBook => ({
  version: 1,
  plans: [],
  runs: [],
});
export const endedRun = (r: Pick<TaskRun, 'status'>) =>
  ['completed', 'cancelled', 'missed', 'skipped'].includes(r.status);
export function runView(run: StoredRun): TaskRun {
  const { runtime, accountedTokens, requestId, lastBatch, ...view } = run;
  return structuredClone({
    ...view,
    requiresReassignment: runtime?.audienceExpired,
  });
}
export function planDraft(plan: TaskPlanDraft): TaskPlanDraft {
  const { name, goal, timing, timeZone, limits, totalTokenBudget } = plan;
  return structuredClone({
    name,
    goal,
    timing,
    timeZone,
    limits,
    totalTokenBudget,
  });
}
function integer(value: unknown, fallback: number, min: number, max: number) {
  const n = value ?? fallback;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max)
    throw new TaskPlanError(`数值须在 ${min}–${max} 之间。`);
  return n;
}
export function validatePlan(
  value: unknown,
  now = Date.now(),
  previous?: TaskPlan,
): TaskPlanDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TaskPlanError('任务格式无效。');
  const v = { ...previous, ...value } as TaskPlanDraft;
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 80)
    throw new TaskPlanError('请填写 80 字以内的任务名称。');
  if (typeof v.goal !== 'string' || !v.goal.trim() || v.goal.length > 2000)
    throw new TaskPlanError('请填写 2000 字以内的任务目标。');
  if (typeof v.timeZone !== 'string' || v.timeZone.length > 100)
    throw new TaskPlanError('请选择有效时区。');
  try {
    new Intl.DateTimeFormat('en', { timeZone: v.timeZone }).format();
  } catch {
    throw new TaskPlanError('请选择有效时区。');
  }
  const t = v.timing;
  if (!t || typeof t !== 'object') throw new TaskPlanError('执行方式无效。');
  let timing: TaskTiming;
  switch (t.kind) {
    case 'immediate':
      timing = { kind: t.kind };
      break;
    case 'once':
      integer(t.at, 0, 1, 8640000000000000);
      if (
        t.at <= now &&
        (previous?.timing.kind !== 'once' || previous.timing.at !== t.at)
      )
        throw new TaskPlanError('执行时间必须在将来。');
      timing = { kind: t.kind, at: t.at };
      break;
    case 'interval':
      timing = {
        kind: t.kind,
        everyMs: integer(t.everyMs, 60000, 60000, 31 * 86400000),
      };
      break;
    case 'daily':
    case 'weekly':
      if (
        typeof t.time !== 'string' ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)
      )
        throw new TaskPlanError('时间格式应为 HH:mm。');
      if (t.kind === 'weekly') {
        if (
          !Array.isArray(t.weekdays) ||
          !t.weekdays.length ||
          t.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
        )
          throw new TaskPlanError('请选择星期。');
        timing = {
          kind: t.kind,
          time: t.time,
          weekdays: [...new Set(t.weekdays)].sort(),
        };
      } else timing = { kind: t.kind, time: t.time };
      break;
    default:
      throw new TaskPlanError('执行方式无效。');
  }
  if (v.limits?.enabled !== undefined && typeof v.limits.enabled !== 'boolean')
    throw new TaskPlanError('执行限制开关必须为布尔值。');
  // Hidden fields do not prevent saving an unlimited task; retain valid values for later use.
  const quota = (value: unknown, fallback: number, min: number, max: number) =>
    v.limits?.enabled === false &&
    (typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < min ||
      value > max)
      ? fallback
      : integer(value, fallback, min, max);
  return {
    name: v.name.trim(),
    goal: v.goal.trim(),
    timing,
    timeZone: v.timeZone,
    limits: {
      enabled: v.limits?.enabled !== false,
      maxTurns: quota(v.limits?.maxTurns, DEFAULT_TASK_LIMITS.maxTurns, 1, 200),
      tokenBudget: quota(
        v.limits?.tokenBudget,
        DEFAULT_TASK_LIMITS.tokenBudget,
        1000,
        1000000,
      ),
      taskTimeoutMs: quota(
        v.limits?.taskTimeoutMs,
        DEFAULT_TASK_LIMITS.taskTimeoutMs,
        60000,
        7200000,
      ),
    },
    totalTokenBudget: quota(v.totalTokenBudget, 500000, 1000, 1000000000),
  };
}
export function newPlan(draft: TaskPlanDraft, now: number): TaskPlan {
  const plan: TaskPlan = {
    ...planDraft(draft),
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    state: 'enabled',
    reason: '',
    spentTokens: 0,
  };
  plan.nextRunAt = nextOccurrence(plan, now);
  return plan;
}
export function newRun(
  plan: TaskPlan,
  at: number,
  source: TaskRun['source'],
): StoredRun {
  return {
    id: randomUUID(),
    planId: plan.id,
    source,
    scheduledAt: at,
    snapshot: planDraft(plan),
    status: 'running',
    reason: '',
    totalTokens: 0,
    accountedTokens: 0,
    logs: [],
  };
}
export function duePlans(book: TaskBook, now: number) {
  return book.plans
    .filter(
      (p) =>
        p.state === 'enabled' &&
        p.nextRunAt !== undefined &&
        p.nextRunAt <= now,
    )
    .sort((a, b) => a.nextRunAt! - b.nextRunAt! || a.createdAt - b.createdAt);
}
/** Timer only selects due work. AgentManager reserves and persists before dispatch. */
export class GatewayScheduler {
  private agents = new Map<string, ReturnType<typeof setTimeout>>();
  cancel(id: string) {
    clearTimeout(this.agents.get(id));
    this.agents.delete(id);
  }
  wake(id: string, ms: number, action: () => void) {
    this.cancel(id);
    if (this.stopped) return;
    const timer = setTimeout(() => {
      this.agents.delete(id);
      action();
    }, ms);
    timer.unref();
    this.agents.set(id, timer);
  }
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  constructor(private readonly tick: () => Promise<void>) {}
  start() {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(async () => {
      this.timer = undefined;
      try {
        await this.tick();
      } catch {
        /* Failed persistence is retried without dispatch. */
      }
      this.start();
    }, 1000);
    this.timer.unref();
  }
  close() {
    this.stopped = true;
    for (const id of this.agents.keys()) this.cancel(id);
    clearTimeout(this.timer);
  }
}

export { GatewayScheduler as TaskScheduler };

import type { AgentTask, AgentTaskStatus } from './agents';

export type TaskTiming =
  | { kind: 'immediate' }
  | { kind: 'once'; at: number }
  | { kind: 'interval'; everyMs: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; weekdays: number[] };
export type TaskLimits = {
  /** Missing on older saves means enabled. */
  enabled?: boolean;
  maxTurns: number;
  tokenBudget: number;
  taskTimeoutMs: number;
};
export type TaskPlanDraft = {
  name: string;
  goal: string;
  timing: TaskTiming;
  timeZone: string;
  limits: TaskLimits;
  totalTokenBudget: number;
};
export type TaskPlan = TaskPlanDraft & {
  id: string;
  createdAt: number;
  updatedAt: number;
  state: 'enabled' | 'paused' | 'completed' | 'archived';
  reason: string;
  nextRunAt?: number;
  spentTokens: number;
  latestRun?: TaskRun;
};
export type TaskRun = {
  id: string;
  planId: string;
  source: 'scheduled' | 'manual' | 'chat' | 'legacy';
  scheduledAt: number;
  startedAt?: number;
  finishedAt?: number;
  snapshot: TaskPlanDraft;
  status: AgentTaskStatus | 'failed' | 'missed' | 'skipped';
  reason: string;
  task?: AgentTask;
  totalTokens: number;
  logs: string[];
  actions?: {
    batchId?: string;
    call: number;
    index: number;
    kind: string;
    status: string;
    detail: string;
  }[];
  requiresReassignment?: boolean;
};
export type TaskRunPage = {
  items: TaskRun[];
  active: TaskRun[];
  total: number;
  nextOffset?: number;
};
export const DEFAULT_TASK_LIMITS: TaskLimits = {
  maxTurns: 100,
  tokenBudget: 50000,
  taskTimeoutMs: 900000,
};
export function isRepeating(timing: TaskTiming) {
  return ['interval', 'daily', 'weekly'].includes(timing.kind);
}

/** Runtime-only values: never persist Infinity in task snapshots. */
export function executionLimits(limits: TaskLimits) {
  return limits.enabled === false
    ? { maxTurns: Infinity, tokenBudget: Infinity, taskTimeoutMs: Infinity }
    : {
        maxTurns: limits.maxTurns,
        tokenBudget: limits.tokenBudget,
        taskTimeoutMs: limits.taskTimeoutMs,
      };
}
export function hasPlanTokenLimit(plan: TaskPlanDraft) {
  return plan.limits.enabled !== false && isRepeating(plan.timing);
}

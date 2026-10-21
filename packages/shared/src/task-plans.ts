import type {
  TaskLimits,
  AICharacterTask,
  AICharacterTaskStatus,
} from './task-contracts';

export type TaskTiming =
  | { kind: 'immediate' }
  | { kind: 'once'; at: number }
  | { kind: 'interval'; everyMs: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; weekdays: number[] };
export type TaskPlanDraft = {
  name: string;
  goal: string;
  timing: TaskTiming;
  timeZone: string;
  limits: TaskLimits;
  /** Missing on existing plans means an explicit override. */
  limitsMode?: 'inherit' | 'override';
  totalTokenBudget: number;
};
export type TaskPlan = TaskPlanDraft & {
  characterId?: string;
  characterName?: string;
  revision?: number;
  imported?: boolean;
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
  planId?: string;
  planRevision?: number;
  characterId?: string;
  characterName?: string;
  source: 'scheduled' | 'manual' | 'chat' | 'legacy';
  scheduledAt: number;
  eventId?: string;
  coalescedTriggers?: number;
  lastTriggerAt?: number;
  startedAt?: number;
  finishedAt?: number;
  snapshot: TaskPlanDraft;
  status: AICharacterTaskStatus | 'queued' | 'failed' | 'missed' | 'skipped';
  reason: string;
  task?: AICharacterTask;
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

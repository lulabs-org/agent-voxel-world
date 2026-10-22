import type { AgentRunState } from '@voxel/agent-runtime';
import type { TaskPlan, TaskRun } from '@voxel/shared';

/**
 * 运行时任务运行快照及上下文
 */
export type StoredRun = TaskRun & {
  runtime?: AgentRunState;
  accountedTokens: number;
  requestId?: string;
  lastBatch?: string;
};

/**
 * 任务持久化存档模型
 */
export type TaskBook = {
  version: 1;
  plans: TaskPlan[];
  runs: StoredRun[];
  currentRunId?: string;
  requests?: Record<string, string>;
};

export type { PlanQueryFilter } from '@voxel/shared/management';

/**
 * 计划控制操作类型
 */
export type PlanControlOperation =
  | 'pause'
  | 'resume'
  | 'archive'
  | 'extend'
  | 'delete';

/**
 * 任务执行控制操作类型
 */
export type RunControlOperation = 'cancel' | 'retry' | 'skip';

/**
 * 任务运行历史分页列表响应结构
 */
export interface TaskRunsPage {
  items: TaskRun[];
  active: TaskRun[];
  total: number;
  nextOffset?: number;
}

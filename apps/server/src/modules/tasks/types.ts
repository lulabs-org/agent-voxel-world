import type { AgentRunState } from '@voxel/agent-runtime';
import type { TaskPlan, TaskRun } from '@voxel/shared';
import type { RpcParams } from '@voxel/gateway-protocol';

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

/**
 * 全局或 Agent 任务计划的分页与搜索过滤参数
 */
export interface PlanQueryFilter {
  state?: RpcParams['state'];
  offset?: number;
  search?: string;
  agentId?: string;
}

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

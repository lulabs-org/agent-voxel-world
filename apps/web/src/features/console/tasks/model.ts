import type { AgentSettings, AgentTaskStatus } from '@voxel/shared';
export const taskStatusNames: Record<AgentTaskStatus, string> = {
  running: '执行任务',
  waiting: '等待环境变化',
  needs_input: '等待你的答复',
  blocked: '任务受阻',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
  budget: '额度用尽 · 已暂停',
};
export type TaskBudget = Pick<
  AgentSettings,
  'maxTurns' | 'tokenBudget' | 'taskTimeoutMs'
>;
export function taskBudgetOf(value: TaskBudget): TaskBudget {
  return {
    maxTurns: value.maxTurns,
    tokenBudget: value.tokenBudget ?? 50000,
    taskTimeoutMs: value.taskTimeoutMs ?? 900000,
  };
}

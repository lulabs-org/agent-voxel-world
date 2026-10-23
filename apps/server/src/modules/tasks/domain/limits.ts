import { type TaskLimits } from '@voxel/shared';
export { hasPlanTokenLimit } from '@voxel/shared';
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

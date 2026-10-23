import { type TaskLimits } from '@voxel/shared';
export { hasPlanTokenLimit } from '@voxel/shared';
/** Runtime-only values: never persist Infinity in task snapshots. */
export function executionLimits(limits: TaskLimits) {
  return limits.enabled === false
    ? {
        maxStalledTurns: Infinity,
        maxTurns: Infinity,
        tokenBudget: Infinity,
        taskTimeoutMs: Infinity,
      }
    : {
        maxTurns: limits.maxTurns,
        maxStalledTurns: limits.maxStalledTurns ?? 3,
        tokenBudget: limits.tokenBudget,
        taskTimeoutMs: limits.taskTimeoutMs,
      };
}

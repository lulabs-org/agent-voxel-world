import type { AgentSettings } from '@voxel/shared';
export type TaskBudget = Pick<
  AgentSettings,
  'maxTurns' | 'tokenBudget' | 'taskTimeoutMs'
>;

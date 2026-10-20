import type { AICharacterSettings } from '@voxel/shared';
export type TaskBudget = Pick<
  AICharacterSettings,
  'maxTurns' | 'tokenBudget' | 'taskTimeoutMs'
>;

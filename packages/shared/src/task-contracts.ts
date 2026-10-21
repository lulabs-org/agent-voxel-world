export type TaskLimits = {
  /** Missing on older saves means enabled. */
  enabled?: boolean;
  maxTurns: number;
  tokenBudget: number;
  taskTimeoutMs: number;
};
export type AICharacterTaskStatus =
  | 'running'
  | 'waiting'
  | 'needs_input'
  | 'blocked'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'budget';
export type AICharacterTask = {
  goal: string;
  status: AICharacterTaskStatus;
  summary: string;
  reason: string;
  owner?: string;
  privateTo?: string;
  calls: number;
  tokens: number;
  estimated: boolean;
  startedAt: number;
  elapsedMs: number;
  waitFor?: 'world' | 'players';
};

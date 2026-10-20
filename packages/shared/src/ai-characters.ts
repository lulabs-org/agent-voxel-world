import type {
  AICharacterPermissions,
  AICharacterSkillId,
} from './ai-character-capabilities';
import type { TaskLimits } from './task-plans';
export type ProviderType = 'deepseek' | 'ollama' | 'compatible';
export const AI_CHARACTER_ROLE_DESCRIPTION_LIMIT = 2000;
export type ProviderInference = Pick<
  AICharacterSettings,
  'timeoutMs' | 'maxTokens' | 'thinking' | 'reasoningEffort'
>;
export type ProviderView = {
  /** Absent in legacy services until inference settings are saved. */
  inference?: ProviderInference;
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  defaultModel: string;
  hasApiKey: boolean;
  jsonMode: boolean;
  tokenField: 'max_tokens' | 'max_completion_tokens';
};
export type AICharacterSettings = {
  providerId: string;
  model: string;
  name: string;
  goal: string;
  /** Persistent identity, responsibilities and style, independent of a task. */
  roleDescription?: string;
  /** Legacy compatibility only; task continuation is decided from progress. */
  continuous: boolean;
  /** Maximum model calls per task, not a target number of turns. */
  maxTurns: number;
  tokenBudget?: number;
  taskTimeoutMs?: number;
  intervalMode: 'fixed' | 'random';
  intervalMinMs: number;
  intervalMaxMs: number;
  intervalMs: number;
  timeoutMs: number;
  maxTokens: number;
  /** @deprecated Legacy input; use permissions for independent action control. */
  allowEdits?: boolean;
  /** Canonical permissions; absent only in legacy configurations. */
  permissions?: AICharacterPermissions;
  skills?: AICharacterSkillId[];
  voiceReplies?: boolean;
  voiceServiceId?: string;
  thinking: 'enabled' | 'disabled';
  reasoningEffort: 'none' | 'low' | 'high' | 'max';
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
export const AI_CHARACTER_LOG_LIMIT = 500;

export type AICharacterUsage = {
  calls: number;
  tokens: number;
  estimated: boolean;
};
export type AICharacterView = AICharacterSettings & {
  voiceServiceName?: string;
  id: string;
  providerName: string;
  status:
    | 'joining'
    | 'running'
    | 'idle'
    | 'stopping'
    | 'stopped'
    | 'completed'
    | 'failed';
  createdAt: number;
  sessionId?: string;
  logs: string[];
  /** UTC epoch milliseconds aligned with logs; null means legacy time is unknown. */
  logTimes?: (number | null)[];
  task?: AICharacterTask;
  /** Limits of the current execution, which may differ from role defaults. */
  taskExecution?: { runId: string; limits: TaskLimits };
  usage?: AICharacterUsage;
  lastResponse?: string;
  /** The original private recipient no longer exists; the task must be reassigned. */
  taskRequiresReassignment?: boolean;
};

import type { AgentPermissions, AgentSkillId } from './agent-capabilities';
export type ProviderType = 'deepseek' | 'ollama' | 'compatible';
export const AGENT_ROLE_DESCRIPTION_LIMIT = 2000;
export type ProviderView = {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  defaultModel: string;
  hasApiKey: boolean;
  jsonMode: boolean;
  tokenField: 'max_tokens' | 'max_completion_tokens';
};
export type AgentSettings = {
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
  permissions?: AgentPermissions;
  skills?: AgentSkillId[];
  voiceReplies?: boolean;
  voiceServiceId?: string;
  thinking: 'enabled' | 'disabled';
  reasoningEffort: 'none' | 'low' | 'high' | 'max';
};
export type AgentTaskStatus =
  | 'running'
  | 'waiting'
  | 'needs_input'
  | 'blocked'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'budget';
export type AgentTask = {
  goal: string;
  status: AgentTaskStatus;
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
export type AgentUsage = { calls: number; tokens: number; estimated: boolean };
export type ManagedAgentView = AgentSettings & {
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
  task?: AgentTask;
  usage?: AgentUsage;
  lastResponse?: string;
  /** The original private recipient no longer exists; the task must be reassigned. */
  taskRequiresReassignment?: boolean;
};

import type { AgentAction } from '../../packages/agent-runtime/src/contracts';
export type TaskDirective = {
  intent:
    | 'reply'
    | 'task'
    | 'update'
    | 'continue'
    | 'pause'
    | 'resume'
    | 'cancel';
  status: 'running' | 'waiting' | 'needs_input' | 'blocked' | 'completed';
  summary: string;
  goal?: string;
  waitFor?: 'world' | 'players';
};

export type AgentDecision = { actions: AgentAction[]; task: TaskDirective };

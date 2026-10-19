import type { AgentTask } from '@voxel/shared';
import type { AgentConfig, AgentSession } from '../contracts';
import type { AgentRunState } from '../task/state';
import type { AgentAttention } from './attention';

export type RunOptions = {
  session: AgentSession;
  config: AgentConfig;
  signal: AbortSignal;
  memory: AgentRunState;
  attention?: AgentAttention;
  log?: (message: string) => void;
  checkpoint?: () => void | Promise<void>;
  hooks?: {
    beforeNewTask?: (task: AgentTask, previous: AgentRunState) => Promise<void>;
  };
};

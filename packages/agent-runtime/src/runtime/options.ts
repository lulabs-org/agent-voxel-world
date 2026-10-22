import type { AICharacterTask } from '@voxel/shared';
import type { AgentConfig, AgentSession } from '../contracts';
import type { AgentRunState } from '../task/state';
import type { AgentAttention } from '../perception/attention';

export type RunOptions = {
  session: AgentSession;
  config: AgentConfig;
  defaults?: AgentConfig;
  signal: AbortSignal;
  memory: AgentRunState;
  attention?: AgentAttention;
  log?: (message: string) => void;
  checkpoint?: () => void | Promise<void>;
  hooks?: {
    beforeNewTask?: (
      task: AICharacterTask,
      previous: AgentRunState,
    ) => Promise<void>;
  };
};

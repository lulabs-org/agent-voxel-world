import type { AICharacterTask, WorldEvent } from '@voxel/shared';
import type { ToolState } from './window';
import type { AgentConfig } from '../../contracts';
import type { AgentSession } from '../../world/session/port';
import type { AgentAttention } from '../../world/observe/attention';
import type { DecisionContext } from './prepare';
import type { RequestBudget } from '../task/budget';
import type { TaskService, TaskLease } from '../task/service';
import type { AgentRunState } from '../task/state';

/**
 * Execution context for a single character event/turn.
 * Encapsulates session access, task invariants, budgeting, and mutation hooks
 * so collaborator tools do not need wide bags of individual callbacks.
 */
export interface TurnContext {
  // State & session
  session: AgentSession;
  service: TaskService;
  budget: RequestBudget;
  state: ToolState;
  activeSignal: AbortSignal;
  memory: AgentRunState;

  // Configurations
  config: AgentConfig;
  userConfig: AgentConfig;
  defaults?: AgentConfig;

  // Turn metadata
  message?: WorldEvent;
  attention?: AgentAttention;
  log?: (message: string) => void;

  // Observation management
  prepared: () => DecisionContext;
  observe: () => Promise<void>;

  // Side-effect & lifecycle actions
  save: () => Promise<void>;
  attach: () => void;
  authorize: () => void;
  send: (text: string) => Promise<void>;

  // Asynchronous action lifecycle
  actionRunning: () => boolean;
  isLaunched: () => boolean;
  onLaunched: () => void;
  launch: (
    id: string,
    controller: AbortController,
    work: Promise<void>,
  ) => void;
  stopAction: () => Promise<void>;
  onActionStopped: () => void;
  onTaskCommitted: (lease: TaskLease) => void;
  beforeNewTaskHook?: (
    task: AICharacterTask,
    previous: AgentRunState,
  ) => Promise<void>;
}

import type { AICharacterTask, WorldEvent } from '@voxel/shared';
import type { AgentConfig } from '../../contracts/config';
import type { DecisionContext } from '../../contracts/observation';
import type { AgentRunState } from '../../contracts/state';
import type { ToolState } from '../../contracts/tool-state';
import type { AgentAttention } from '../../world/observe/attention';
import type { AgentSession } from '../../world/session/port';
import type { RequestBudget } from '../task/budget';
import type { TaskLease, TaskService } from '../task/service';

/**
 * Everything a tool handler may touch. Implemented by the turn and by test
 * doubles; tools never import the turn implementation itself.
 */
export interface ToolHost {
  readonly session: AgentSession;
  readonly service: TaskService;
  readonly budget: RequestBudget;
  readonly state: ToolState;
  readonly activeSignal: AbortSignal;
  readonly memory: AgentRunState;
  readonly config: AgentConfig;
  readonly userConfig: AgentConfig;
  readonly defaults?: AgentConfig;
  readonly message?: WorldEvent;
  readonly attention?: AgentAttention;
  readonly log?: (message: string) => void;
  readonly beforeNewTaskHook?: (
    task: AICharacterTask,
    previous: AgentRunState,
  ) => Promise<void>;

  prepared(): DecisionContext;
  observe(): Promise<void>;
  save(): Promise<void>;
  attach(): void;
  authorize(): void;
  send(text: string): Promise<void>;

  actionRunning(): boolean;
  isLaunched(): boolean;
  onLaunched(): void;
  launch(id: string, controller: AbortController, work: Promise<void>): void;
  stopAction(): Promise<void>;
  onActionStopped(): void;
  onTaskCommitted(lease: TaskLease): void;
}

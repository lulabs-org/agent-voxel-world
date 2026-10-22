export { aiCharacterPermissions } from '@voxel/shared';
export type {
  Observation,
  Result,
  AgentSession,
  PlannedEdit,
  BuildAction,
  BuildResult,
  AgentAction,
  ActionResult,
  NavigationResult,
  ActionExecution,
  BatchResult,
  AgentConfig,
  ModelEndpoint,
} from './contracts';

export { AgentRuntimeError } from './errors';

export { Session, delay, until } from './transport/session';
export { cancellable } from './transport/cancellable';

export { parseAction } from './actions/parse';

export { executeAction } from './actions/execute';
export { executeBatch } from './actions/batch';

export {
  parseBuildAction,
  houseBlocks,
  executeBuild,
} from './actions/building';

export { listModels } from './models/catalog';

export { AgentAttention } from './perception/attention';

export { newTask, restoreBatchHistory, type AgentRunState } from './task/state';

export { worldSignature } from './perception/observation';

export { isolateChatScope } from './perception/chat-context';

export { runAgent, nextIntervalMs } from './runtime/scheduled-loop';

export { RequestBudget, checkBudgetCap } from './task/budget';

export { AgentRunner, type RunOptions } from './runtime/agent-runner';
export { restoreCheckpoint } from './cognition/checkpoint';

export { TaskService, type TaskCommand, type TaskLease } from './task/service';

export { recordEvent } from './task/inbox';
export type { CharacterEvent } from './task/state';

export {
  AICharacterManager,
  AICharacterOrchestrator,
  type AICharacterDependencies,
} from './services/orchestrator';
export { CharacterVoiceCoordinator } from './services/voice-coordinator';
export { validateAICharacter } from './domain/validation';
export {
  appendAICharacterLog,
  migrateLegacyLogs,
  restoreAICharacterLogs,
} from './domain/activity-log';
export {
  AICharacterRegistry,
  type Job,
  type HostedAICharacter,
  type VoiceServicePort,
  type CharacterRecord,
  active,
  resident,
  isJobBusy,
  canWakeJob,
} from './domain/types';
export { taskExecutionState, executionState } from './domain/task-adapter';
export { AICharacterWakeScheduler } from './runtime/wake-scheduler';
export { AICharacterHost } from './runtime/character-host';
export type { ExecutionContext } from './runtime/execution-context';
export { handleWorldEvent } from './runtime/world-event-handler';
export { installAICharacterRoutes, type AICharacterRoutePort } from './routes';

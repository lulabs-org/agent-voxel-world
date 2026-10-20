import type { AgentRunState } from '@voxel/agent-runtime';
import type {
  AICharacterView,
  VoiceServiceView,
  TaskPlan,
} from '@voxel/shared';
import type { TaskBook, StoredRun } from '../tasks';
import type { ProviderPort } from '../providers/provider-port';

export type { ProviderPort };

export type RestoredAICharacterRecord = AICharacterView & {
  runtime?: AgentRunState;
  taskBook?: TaskBook; // Legacy read only.
  currentRunId?: string;
};

export type AICharacterArchive = {
  version: 2;
  characters: RestoredAICharacterRecord[];
  plans: TaskPlan[];
  runs: StoredRun[];
  requests: Record<string, string>;
};

/** Read-only shape of the previous management archive. */
type LegacyBinding<T> = Omit<T, 'characterId' | 'characterName'> & {
  agentId?: string;
  agentName?: string;
};
export type LegacyAgentArchive = {
  version: 1;
  agents: RestoredAICharacterRecord[];
  plans: LegacyBinding<TaskPlan>[];
  runs: LegacyBinding<StoredRun>[];
  requests: Record<string, string>;
};

export interface ArchivePort {
  load(): Promise<
    | RestoredAICharacterRecord[]
    | LegacyAgentArchive
    | AICharacterArchive
    | undefined
  >;
  save(records: AICharacterArchive): Promise<void>;
}

export interface VoiceServicePort {
  list(): VoiceServiceView[];
  get(id: string): unknown;
  bind(sessionId: string, serviceId: string): void;
  unbind(sessionId: string): void;
  remove(id: string, inUse: () => boolean): Promise<void>;
}

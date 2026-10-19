import type { AgentRunState } from '@voxel/agent-runtime';
import type {
  ManagedAgentView,
  VoiceServiceView,
  TaskPlan,
} from '@voxel/shared';
import type { TaskBook, StoredRun } from '../tasks';
import type { ProviderPort } from '../providers/provider-port';

export type { ProviderPort };

export type RestoredAgentRecord = ManagedAgentView & {
  runtime?: AgentRunState;
  taskBook?: TaskBook; // Legacy read only.
  currentRunId?: string;
};

export type GatewayArchive = {
  version: 1;
  agents: RestoredAgentRecord[];
  plans: TaskPlan[];
  runs: StoredRun[];
  requests: Record<string, string>;
};

export interface ArchivePort {
  load(): Promise<RestoredAgentRecord[] | GatewayArchive | undefined>;
  save(records: GatewayArchive): Promise<void>;
}

export interface VoiceServicePort {
  list(): VoiceServiceView[];
  get(id: string): unknown;
  bind(sessionId: string, serviceId: string): void;
  unbind(sessionId: string): void;
  remove(id: string, inUse: () => boolean): Promise<void>;
}

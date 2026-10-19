import type { AgentRunState } from '@voxel/agent-runtime';
import type {
  ManagedAgentView,
  ProviderView,
  VoiceServiceView,
} from '@voxel/shared';
import type { SavedProvider } from './validation';
import type { TaskBook } from './plans/model';
export type RestoredAgentRecord = ManagedAgentView & {
  runtime?: AgentRunState;
  taskBook?: TaskBook; // Legacy read only.
  currentRunId?: string;
};
export type GatewayArchive = {
  version: 1;
  agents: RestoredAgentRecord[];
  plans: import('@voxel/shared').TaskPlan[];
  runs: import('./plans/model').StoredRun[];
  requests: Record<string, string>;
};
export interface ArchivePort {
  load(): Promise<RestoredAgentRecord[] | GatewayArchive | undefined>;
  save(records: GatewayArchive): Promise<void>;
}
export interface ProviderPort {
  list(): ProviderView[];
  get(id: string): SavedProvider;
  save(value: unknown, id?: string): Promise<ProviderView>;
  remove(id: string): Promise<void>;
}
export interface VoiceServicePort {
  list(): VoiceServiceView[];
  get(id: string): unknown;
  bind(sessionId: string, serviceId: string): void;
  unbind(sessionId: string): void;
  remove(id: string, inUse: () => boolean): Promise<void>;
}

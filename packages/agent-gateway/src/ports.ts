import type { AgentRunState } from '@voxel/agent-runtime';
import type {
  ManagedAgentView,
  ProviderView,
  VoiceServiceView,
} from '@voxel/shared';
import type { SavedProvider } from './validation';
import type { TaskBook } from './scheduler';
export type RestoredAgentRecord = ManagedAgentView & {
  runtime?: AgentRunState;
  taskBook?: TaskBook;
};
export interface ArchivePort {
  load(): Promise<RestoredAgentRecord[] | undefined>;
  save(records: RestoredAgentRecord[]): Promise<void>;
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

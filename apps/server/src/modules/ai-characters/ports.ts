import type { VoiceServiceView } from '@voxel/shared';
export type { ProviderPort } from '../providers/provider-port';
export type { CharacterRecord as RestoredAICharacterRecord } from './record';
export type {
  ManagementArchive as AICharacterArchive,
  LegacyAgentArchive,
  ArchivePort,
} from '../../persistence/archive';

export interface VoiceServicePort {
  list(): VoiceServiceView[];
  get(id: string): unknown;
  bind(sessionId: string, serviceId: string): void;
  unbind(sessionId: string): void;
  remove(id: string, inUse: () => boolean): Promise<void>;
}

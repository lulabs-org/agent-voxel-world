import {
  AICharacterOrchestrator,
  type AICharacterDependencies,
} from './orchestrator';
import { Session, AgentRunner } from '@voxel/agent-runtime';
import { ProviderStore } from '../providers/provider-store';
import type { VoiceServiceStore } from '../audio/tts/voice-services';
import {
  readManagementArchive,
  writeManagementArchive,
} from '../../persistence/archive-file';

/** AICharacterManager is the concrete orchestrator in the server with file-based persistence defaults. */
export class AICharacterManager extends AICharacterOrchestrator {
  declare readonly voiceServices: VoiceServiceStore | undefined;

  constructor(
    providers: ProviderStore,
    serverUrl: string | (() => string),
    dependencies: AICharacterDependencies = {
      session: (url) => new Session(url),
      runner: (_config, provider) => new AgentRunner(provider),
    },
    voiceServices?: VoiceServiceStore,
  ) {
    const path = `${providers.path}.agents.json`;
    super(providers, serverUrl, dependencies, voiceServices, {
      load: () => readManagementArchive(path),
      save: (records) => writeManagementArchive(path, records),
    });
  }
}

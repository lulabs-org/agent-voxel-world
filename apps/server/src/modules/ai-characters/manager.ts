import {
  AICharacterOrchestrator,
  type AICharacterDependencies,
} from './orchestrator';
import { Session, AgentRunner, listModels } from '@voxel/agent-runtime';
import { ProviderStore } from '../providers/provider-store';
import type { VoiceServiceStore } from '../audio/tts/voice-services';
import { readAICharacterArchive, writeAICharacterArchive } from './storage';

/** AICharacterManager is the concrete orchestrator in the server with file-based persistence defaults. */
export class AICharacterManager extends AICharacterOrchestrator {
  declare readonly voiceServices: VoiceServiceStore | undefined;

  constructor(
    providers: ProviderStore,
    serverUrl: string | (() => string),
    dependencies: AICharacterDependencies = {
      session: (url) => new Session(url),
      runner: (_config, provider) => new AgentRunner(provider),
      models: (provider) => listModels(provider, provider.apiKey),
    },
    voiceServices?: VoiceServiceStore,
  ) {
    const path = `${providers.path}.agents.json`;
    super(providers, serverUrl, dependencies, voiceServices, {
      load: () => readAICharacterArchive(path),
      save: (records) => writeAICharacterArchive(path, records),
    });
  }
}

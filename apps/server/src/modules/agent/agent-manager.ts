import {
  AgentOrchestrator,
  type AgentDependencies,
  type GatewayDependencies,
} from './agent-orchestrator';
import { Session, AgentRunner, listModels } from '@voxel/agent-runtime';
import { ProviderStore } from '../providers/provider-store';
import type { VoiceServiceStore } from '../audio/tts/voice-services';
import { readAgentArchive, writeAgentArchive } from './agent-storage';

export { type AgentDependencies, type GatewayDependencies };

/** AgentManager is the concrete orchestrator in the server with file-based persistence defaults. */
export class AgentManager extends AgentOrchestrator {
  declare readonly voiceServices: VoiceServiceStore | undefined;

  constructor(
    providers: ProviderStore,
    serverUrl: string | (() => string),
    dependencies: AgentDependencies = {
      session: (url) => new Session(url),
      runner: (_config, provider) => new AgentRunner(provider),
      models: (provider) => listModels(provider, provider.apiKey),
    },
    voiceServices?: VoiceServiceStore,
  ) {
    const path = `${providers.path}.agents.json`;
    super(providers, serverUrl, dependencies, voiceServices, {
      load: () => readAgentArchive(path),
      save: (records) => writeAgentArchive(path, records),
    });
  }
}

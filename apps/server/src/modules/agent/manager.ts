import { AgentGateway, type GatewayDependencies } from '@voxel/agent-gateway';
import { Session, AgentRunner, listModels } from '@voxel/agent-runtime';
import { ProviderStore } from './provider-store';
import type { VoiceServiceStore } from '../audio/tts/voice-services';
import { readAgentArchive, writeAgentArchive } from './agent-storage';
/** Compatibility facade; all ownership and scheduling live in AgentGateway. */
export class AgentManager extends AgentGateway {
  declare readonly voiceServices: VoiceServiceStore | undefined;
  constructor(
    providers: ProviderStore,
    serverUrl: string | (() => string),
    dependencies: GatewayDependencies = {
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

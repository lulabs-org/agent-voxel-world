import {
  AgentOrchestrator,
  type GatewayDependencies,
} from '@voxel/agent-orchestrator';
import { AgentGateway } from '@voxel/agent-gateway';
import { Session, AgentRunner, listModels } from '@voxel/agent-runtime';
import { ProviderStore } from './provider-store';
import type { VoiceServiceStore } from '../audio/tts/voice-services';
import { readAgentArchive, writeAgentArchive } from './agent-storage';
import type { RpcMethod, RpcParams } from '@voxel/gateway-protocol';

export { type GatewayDependencies };

/** AgentManager is the concrete orchestrator in the server, with an attached AgentGateway. */
export class AgentManager extends AgentOrchestrator {
  declare readonly voiceServices: VoiceServiceStore | undefined;
  readonly gateway: AgentGateway;

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
    this.gateway = new AgentGateway(this);
  }

  get commands() {
    return this.gateway.commands;
  }

  dispatch(
    method: RpcMethod,
    params: RpcParams,
    commandId?: string,
    legacy = false,
  ) {
    return this.gateway.dispatch(method, params, commandId, legacy);
  }
}

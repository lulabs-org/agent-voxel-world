import { GatewayAuth } from './modules/gateway/auth';
import { gatewaySocket } from './modules/gateway/socket';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, matchMaker } from '@colyseus/core';
import { createApp } from './app';
import { env, type ServerConfig } from './config';
import {
  AICharacterManager,
  type AICharacterDependencies,
} from './modules/ai-characters';
import { ProviderStore } from './modules/providers/provider-store';
import { VoiceServiceStore } from './modules/audio/tts/voice-services';
import { AsrSettingsStore } from './modules/audio/asr/asr-settings';
import { LocalSpeech } from './modules/audio/asr/local-speech';
import { createVoiceProvider } from './modules/audio/session';
import { WorldRoom } from './modules/world/room';
import { WorldStore } from './modules/world/store';
import { RoutedWebSocketTransport } from './transport/websocket.transport';
import {
  createAsrSocket,
  type AsrBridge,
} from './modules/audio/asr/asr.socket';
import { checkStartupDatabase } from './startup';

export type ServerOptions = {
  config?: ServerConfig;
  providers?: ProviderStore;
  voiceServices?: VoiceServiceStore;
  asrSettings?: AsrSettingsStore;
  speech?: LocalSpeech;
  worldStore?: WorldStore;
  agentDependencies?: AICharacterDependencies;
  databaseCheck?: (url: string) => Promise<void>;
  asrBridge?: AsrBridge;
};

const wsHost = (host: string) => {
  const h = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
  return h.includes(':') ? `[${h}]` : h;
};

/** Owns one world's resources. Both production and tests use this lifecycle. */
export async function createServer(options: ServerOptions = {}) {
  const config = options.config ?? env.readServer();
  await (options.databaseCheck ?? checkStartupDatabase)(config.databaseUrl);
  const providers = options.providers ?? new ProviderStore();
  const voiceServices = options.voiceServices ?? new VoiceServiceStore();
  const asrSettings = options.asrSettings ?? new AsrSettingsStore();
  // Each store reads its own file, so loads are independent and parallel-safe.
  const [gatewayAuth] = await Promise.all([
    GatewayAuth.load(config.gateway),
    providers.load(),
    voiceServices.load(),
    asrSettings.load(),
  ]);
  // Validate fallible provider construction before allocating network resources.
  const voiceProvider = createVoiceProvider(
    config.voice.provider,
    config.voice,
  );
  const store = options.worldStore ?? new WorldStore(config.databaseUrl);
  let world: WorldRoom | undefined;
  let url = '';
  const characters = new AICharacterManager(
    providers,
    () => url,
    options.agentDependencies,
    voiceServices,
  );
  const app = createApp({
    config,
    gatewayAuth,
    characters,
    modelCatalog: characters.modelCatalog,
    voiceServices,
    asrSettings,
    speech: options.speech ?? new LocalSpeech(),
    world: () => world,
  });
  const http = createHttpServer(app);
  const transport = new RoutedWebSocketTransport(
    http,
    new Map([
      [
        '/ai-characters/gateway',
        (socket, req) =>
          gatewaySocket(characters.events, gatewayAuth, socket, req),
      ],
      [
        '/voice/asr/realtime',
        createAsrSocket(asrSettings, options.asrBridge, config.webOrigin),
      ],
    ]),
  );
  const server = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false,
  });
  server.define('world', WorldRoom, {
    voiceServices,
    store,
    voiceProvider,
    realtimeConfig: () => config.realtime,
  });
  server.onBeforeShutdown(() => characters.close());
  let closing: Promise<void> | undefined;
  let listening = false;
  const close = () =>
    (closing ??= (async () => {
      try {
        await server.gracefullyShutdown(false);
      } finally {
        // Colyseus closes its players; explicitly close ASR upgrades and HTTP/SSE too.
        transport.closeConnections();
        if (http.listening) {
          http.close();
          http.closeAllConnections();
          await once(http, 'close');
        }
        if (!world) await store.close();
        world = undefined;
      }
    })());
  return {
    app,
    http,
    server,
    characters,
    providers,
    voiceServices,
    asrSettings,
    get world() {
      if (!world) throw Error('世界尚未启动。');
      return world;
    },
    get url() {
      return url;
    },
    close,
    async listen() {
      if (closing || listening) throw Error('服务器已经启动或关闭。');
      listening = true;
      try {
        await server.listen(config.port, config.host);
        url = `ws://${wsHost(config.host)}:${(http.address() as AddressInfo).port}`;
        const listing = await matchMaker.createRoom('world', {});
        world = matchMaker.getLocalRoomById(listing.roomId) as WorldRoom;
        await characters.load();
        return url;
      } catch (error) {
        await close();
        throw error;
      }
    },
  };
}

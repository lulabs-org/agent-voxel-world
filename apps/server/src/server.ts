import { randomUUID } from 'node:crypto';
import { GatewayAuth } from './modules/gateway/auth';
import { gatewaySocket } from './modules/gateway/socket';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { Server, matchMaker } from '@colyseus/core';
import { createApp } from './app';
import { readServerConfig, type ServerConfig } from './config';
import { AgentManager } from './modules/agent/manager';
import { ProviderStore } from './modules/agent/provider-store';
import { VoiceServiceStore } from './modules/audio/tts/voice-services';
import { AsrSettingsStore } from './modules/audio/asr/asr-settings';
import { LocalSpeech } from './modules/audio/asr/local-speech';
import { createVoiceProvider } from './modules/audio/session/voice';
import { WorldRoom } from './modules/world/room';
import { WorldStore } from './modules/world/store';
import { AsrWebSocketTransport } from './transport/asr-websocket.transport';
import { checkStartupDatabase } from './startup';

export type ServerOptions = {
  config?: ServerConfig;
  providers?: ProviderStore;
  voiceServices?: VoiceServiceStore;
  asrSettings?: AsrSettingsStore;
  speech?: LocalSpeech;
  worldStore?: WorldStore;
  agentDependencies?: ConstructorParameters<typeof AgentManager>[2];
  databaseCheck?: (url: string) => Promise<void>;
  asrBridge?: ConstructorParameters<typeof AsrWebSocketTransport>[2];
};

/** Owns one world's resources. Both production and tests use this lifecycle. */
export async function createServer(options: ServerOptions = {}) {
  const config = options.config ?? readServerConfig();
  await (options.databaseCheck ?? checkStartupDatabase)(config.databaseUrl);
  const gatewayAuth = await GatewayAuth.load(config.gateway);
  const gatewayEpoch = randomUUID();
  const providers = options.providers ?? new ProviderStore();
  const voiceServices = options.voiceServices ?? new VoiceServiceStore();
  const asrSettings = options.asrSettings ?? new AsrSettingsStore();
  await providers.load();
  await voiceServices.load();
  await asrSettings.load();
  // Validate fallible provider construction before allocating network resources.
  const voiceProvider = createVoiceProvider(
    config.voice.provider,
    config.voice,
  );
  const store = options.worldStore ?? new WorldStore(config.databaseUrl);
  let world: WorldRoom | undefined;
  let url = '';
  const agents = new AgentManager(
    providers,
    () => url,
    options.agentDependencies,
    voiceServices,
  );
  const app = createApp({
    config,
    gatewayAuth,
    agents,
    asrSettings,
    speech: options.speech ?? new LocalSpeech(),
    world: () => world,
  });
  const http = createHttpServer(app);
  const sockets = new Set<Socket>();
  http.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  const transport = new AsrWebSocketTransport(
    http,
    asrSettings,
    options.asrBridge,
    config.webOrigin,
    (socket, req) =>
      gatewaySocket(agents.gateway, gatewayAuth, gatewayEpoch, socket, req),
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
  server.onBeforeShutdown(() => agents.close());
  let closing: Promise<void> | undefined;
  let listening = false;
  const close = () =>
    (closing ??= (async () => {
      const httpClosed = http.listening
        ? new Promise<void>((resolve) => http.once('close', () => resolve()))
        : Promise.resolve();
      try {
        await server.gracefullyShutdown(false);
      } finally {
        // Colyseus closes its players; explicitly close ASR upgrades and HTTP/SSE too.
        transport.closeConnections();
        for (const socket of sockets) socket.destroy();
        if (http.listening) http.close();
        await httpClosed;
        if (!world) await store.close();
        world = undefined;
      }
    })());
  return {
    app,
    http,
    server,
    agents,
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
        const host = ['0.0.0.0', '::'].includes(config.host)
          ? '127.0.0.1'
          : config.host;
        url = `ws://${host.includes(':') ? `[${host}]` : host}:${(http.address() as AddressInfo).port}`;
        const listing = await matchMaker.createRoom('world', {});
        world = matchMaker.getLocalRoomById(listing.roomId) as WorldRoom;
        await agents.load();
        return url;
      } catch (error) {
        await close();
        throw error;
      }
    },
  };
}

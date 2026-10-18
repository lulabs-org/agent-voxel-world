import { installChatRoutes } from './routes/chat.routes';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
import express from 'express';
import { createServer } from 'node:http';
import { Server, matchMaker } from '@colyseus/core';
import { AsrWebSocketTransport, installAsrRoutes } from './routes/asr.routes';
import { AsrSettingsStore } from './audio/asr-settings';
import { WorldRoom } from './world/room';
import { installSpeechRoutes } from './routes/speech.routes';
import { installPresenceRoutes } from './routes/presence.routes';
import { installWorldRoutes } from './routes/world.routes';
import { installHealthRoutes } from './routes/health.routes';
import { installDocsRoutes } from './routes/docs.routes';
import { AgentManager, ProviderStore } from './agent/manager';
import { installAgentRoutes } from './routes/agent.routes';
import { checkStartupDatabase } from './startup';
import { VoiceServiceStore } from './audio/voice-services';
import { LocalSpeech } from './audio/local-speech';

try {
  await checkStartupDatabase();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const app = express();
app.use((req, res, next) => {
  if (
    req.headers.origin === (process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173')
  )
    res.header('Access-Control-Allow-Origin', req.headers.origin);
  next();
});

installDocsRoutes(app);
installHealthRoutes(app);

const speech = new LocalSpeech();
const asrSettings = new AsrSettingsStore();
await asrSettings.load();
installSpeechRoutes(app, speech, asrSettings);
installAsrRoutes(app, asrSettings);

const http = createServer(app);
const server = new Server({
  transport: new AsrWebSocketTransport(http, asrSettings),
  greet: false,
});
const voiceServices = new VoiceServiceStore();
await voiceServices.load();
server.define('world', WorldRoom, { voiceServices });
const port = Number(process.env.PORT ?? 2567);
const providers = new ProviderStore();
await providers.load();
const agents = new AgentManager(
  providers,
  `ws://127.0.0.1:${port}`,
  undefined,
  voiceServices,
);
installAgentRoutes(app, agents);
server.onBeforeShutdown(() => agents.close());
await server.listen(port, '127.0.0.1');
const world = await matchMaker.createRoom('world', {});
installWorldRoutes(app, () => world.roomId);
await agents.load();
installChatRoutes(
  app,
  () =>
    (matchMaker.getLocalRoomById(world.roomId) as WorldRoom | undefined)?.chat,
  speech,
  () =>
    (matchMaker.getLocalRoomById(world.roomId) as WorldRoom | undefined)
      ?.agentSpeech,
);
installPresenceRoutes(app, () =>
  (
    matchMaker.getLocalRoomById(world.roomId) as WorldRoom | undefined
  )?.getPresence(),
);
console.log(`Voxel server http://127.0.0.1:${port}`);
console.log(`Swagger UI   http://127.0.0.1:${port}/api-docs`);
console.log(`OpenAPI JSON http://127.0.0.1:${port}/api-docs.json`);

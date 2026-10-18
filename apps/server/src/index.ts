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
import { AgentManager, ProviderStore } from './agent/manager';
import { installAgentRoutes } from './routes/agent.routes';
import { checkStartupDatabase } from './startup';
import { VoiceServiceStore } from './audio/voice-services';
import { LocalSpeech } from './audio/local-speech';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger';

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

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(swaggerSpec);
});

const speech = new LocalSpeech();
const asrSettings = new AsrSettingsStore();
await asrSettings.load();
installSpeechRoutes(app, speech, asrSettings);
installAsrRoutes(app, asrSettings);

/**
 * @openapi
 * /health:
 *   get:
 *     summary: 服务器健康状态检查
 *     description: 获取服务器状态、协议版本、持久化方式与语音提供者配置
 *     tags:
 *       - System
 *     responses:
 *       200:
 *         description: 成功返回系统健康信息
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 protocol:
 *                   type: integer
 *                   example: 1
 *                 persistence:
 *                   type: string
 *                   example: memory
 *                 voice:
 *                   type: string
 *                   example: mock
 *                 voiceProviders:
 *                   type: array
 *                   items:
 *                     type: string
 */
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    protocol: 1,
    persistence: process.env.DATABASE_URL ? 'postgresql' : 'memory',
    voice: process.env.VOICE_PROVIDER ?? 'mock',
    voiceProviders: [
      'mock',
      'browser',
      ...(process.env.OLLAMA_MODEL ? ['ollama'] : []),
    ],
  }),
);
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
/**
 * @openapi
 * /world:
 *   get:
 *     summary: 获取当前世界房间 ID
 *     description: 获取 Colyseus 当前活动的 WorldRoom 实例房间 ID
 *     tags:
 *       - World
 *     responses:
 *       200:
 *         description: 返回世界房间信息
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 roomId:
 *                   type: string
 *                   example: 4xK9pL2
 */
app.get('/world', (_req, res) => res.json({ roomId: world.roomId }));
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

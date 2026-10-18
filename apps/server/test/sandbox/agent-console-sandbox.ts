import { fixtureRunnerFactory } from './../../../../tests/support/decision-fixture';
/** Isolated UI acceptance world: no dotenv, no production config and no paid model calls. */
import express from 'express';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Session, until, type AgentRunState } from '@voxel/agent-runtime';
import { WorldRoom } from '../../src/world/room';
import { AgentManager, ProviderStore } from '../../src/agent/manager';
import { VoiceServiceStore } from '../../src/audio/voice-services';
import { installAgentRoutes } from '../../src/routes/agent.routes';
import { installPresenceRoutes } from '../../src/routes/presence.routes';
process.env.DATABASE_URL = '';
process.env.VOICE_PROVIDER = 'mock';
process.env.WEB_ORIGIN = 'http://127.0.0.1:5189';
const dir = await mkdtemp(join(tmpdir(), 'agent-console-'));
const app = express();
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.WEB_ORIGIN);
  next();
});
const server = new Server({
  transport: new WebSocketTransport({ server: createServer(app) }),
  greet: false,
  gracefullyShutdown: false,
});
server.define('world', WorldRoom);
let manager: AgentManager | undefined;
let calls = 0;
try {
  await server.listen(2589, '127.0.0.1');
  const listing = await matchMaker.createRoom('world', {});
  const room = matchMaker.getLocalRoomById(listing.roomId) as WorldRoom;
  app.get('/world', (_req, res) => res.json({ roomId: listing.roomId }));
  installPresenceRoutes(app, () => room.getPresence());
  const providers = new ProviderStore(join(dir, 'providers.json'));
  await providers.load({ DEEPSEEK_API_KEY: 'fixture-only' });
  const voices = new VoiceServiceStore(join(dir, 'voices.json'));
  await voices.load();
  manager = new AgentManager(
    providers,
    'ws://127.0.0.1:2589',
    {
      session: (url) => new Session(url),
      models: async () => ['fixture-model'],
      runner: fixtureRunnerFactory(() => ({
        decide: async (_observation, memory) => {
          calls++;
          const goal = (memory as AgentRunState | undefined)?.task?.goal ?? '';
          return {
            actions: [{ type: 'wait' }],
            task: {
              intent: 'continue',
              status: goal.includes('等待')
                ? 'waiting'
                : goal.includes('循环')
                  ? 'running'
                  : 'completed',
              waitFor: goal.includes('等待') ? 'world' : undefined,
              summary: '已观察附近环境，等待下一步安排。',
            },
          };
        },
      })),
    },
    voices,
  );
  installAgentRoutes(app, manager);
  app.get('/fixture-status', (_req, res) =>
    res.json({ calls, agents: manager!.list() }),
  );
  const a = manager.create({
    providerId: 'deepseek',
    model: 'fixture-model',
    name: '林间向导',
    goal: '',
    startTask: false,
  });
  const b = manager.create({
    providerId: 'deepseek',
    model: 'fixture-model',
    name: '营地建筑师',
    goal: '等待附近环境变化',
    allowEdits: true,
  });
  await until(
    () => manager!.list().filter((j) => j.status === 'idle').length === 2,
  );
  manager.stop(a.id);
  await until(
    () => manager!.list().find((j) => j.id === a.id)?.status === 'stopped',
  );
  console.log(
    `Agent console sandbox ready: backend 2589, frontend origin 5189. Temporary data only. ${b.id}`,
  );
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
} finally {
  await manager?.close();
  await server.gracefullyShutdown(false);
  await rm(dir, { recursive: true, force: true });
}

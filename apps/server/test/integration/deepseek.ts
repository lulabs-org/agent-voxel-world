import { toolResponse } from '../../../../tests/support/pi-response';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { WorldRoom } from '../../src/world/room';
import {
  Session,
  AgentRunner,
  runAgent,
  until,
  houseBlocks,
  type BuildAction,
} from '@voxel/agent-runtime';

process.env.DATABASE_URL = '';
process.env.VOICE_PROVIDER = 'mock';
const app = express(),
  http = createServer(app);
const server = new Server({
  transport: new WebSocketTransport({ server: http }),
  greet: false,
  gracefullyShutdown: false,
});
server.define('world', WorldRoom);
let session: Session | undefined;
try {
  await server.listen(0, '127.0.0.1');
  const listing = await matchMaker.createRoom('world', {});
  const room = matchMaker.getLocalRoomById(listing.roomId) as WorldRoom;
  app.get('/world', (_req, res) => res.json({ roomId: listing.roomId }));
  process.env.SERVER_URL = `ws://127.0.0.1:${(http.address() as { port: number }).port}`;
  session = await new Session().join('DeepSeek fixture', 'ai-agent');
  const first = await session.observe();
  assert.equal(first.self.kind, 'ai-agent');
  const house: Extract<BuildAction, { type: 'house' }> = {
    type: 'house',
    x: 1,
    y: 3,
    z: 0,
    width: 3,
    depth: 3,
    height: 4,
    material: 'wood',
    door: 'west',
  };
  const actions = [
    { type: 'goto', x: 0.2, y: 2.5, z: -1 },
    { type: 'chat', text: 'SDK fixture hello' },
    { type: 'edit', x: 2, y: 3, z: 1, material: 'wood' },
    house,
  ];
  const calls: RequestInit[] = [];
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    calls.push(init!);
    return toolResponse(
      calls.length === 1
        ? actions.map(({ type, ...args }) => ({ name: type, arguments: args }))
        : [
            {
              name: 'update_task',
              arguments: {
                intent: 'continue',
                status: 'completed',
                summary: '观察确认房屋完成',
              },
            },
          ],
    );
  };
  const config = {
    apiKey: 'fixture-only',
    name: 'Fixture',
    model: 'deepseek-flash',
    goal: '测试任务',
    allowEdits: true,
    voiceReplies: false,
    continuous: false,
    intervalMode: 'fixed' as const,
    intervalMinMs: 4000,
    intervalMaxMs: 8000,
    thinking: 'disabled' as const,
    reasoningEffort: 'high' as const,
    maxTokens: 512,
    tokenBudget: 50000,
    taskTimeoutMs: 900000,
    timeoutMs: 30000,
    maxTurns: 2,
    intervalMs: 0,
  };
  await runAgent(
    session,
    new AgentRunner(undefined, request),
    config,
    new AbortController().signal,
    () => {},
  );
  const last = await session.observe();
  assert(last.self.x > first.self.x);
  assert(
    session.events.some(
      (e) =>
        e.type === 'chat' &&
        (e.data as { text: string }).text === 'SDK fixture hello',
    ),
  );
  const blueprint = houseBlocks(house);
  assert.equal(blueprint.length, 32);
  assert.equal(
    last.revision,
    first.revision + blueprint.length,
    JSON.stringify({
      self: last.self,
      missing: blueprint.filter(
        (b) => !room.blocks.has(`${b.x},${b.y},${b.z}`),
      ),
    }),
  );
  for (const block of blueprint)
    assert.equal(
      room.blocks.get(`${block.x},${block.y},${block.z}`)?.material,
      'wood',
    );
  assert.equal(room.blocks.has('1,4,1'), false, 'door remains open');
  assert.equal(room.blocks.has('2,4,1'), false, 'interior remains hollow');
  assert.equal(room.blocks.get('2,3,1')?.material, 'wood');
  assert.equal(
    calls.length,
    2,
    'one model call executes four actions; a second verifies completion',
  );
  assert(String(calls[1].body).includes('已从连续位置观察确认到达'));
  await session.close();
  await session.close(); // SIGINT + finally cleanup must be idempotent.
  await until(() => room.state.players.size === 0);
  console.log(
    'PASS: Pi tool loop executes goto + chat + edit + 32-block house, fresh revisions and observations, second-call completion verification, idempotent cleanup. Fixture inference only.',
  );
} finally {
  await session?.close();
  await server.gracefullyShutdown(false);
}

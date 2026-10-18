import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentManager, ProviderStore } from '../../src/agent/manager';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { WorldRoom } from '../../src/world/room';
import {
  Session,
  executeAction,
  AgentRunner,
  runAgent,
  newTask,
  delay,
  until,
  type AgentRunState,
} from '@voxel/agent-runtime';
import { key } from '@voxel/shared';
import { toolResponse } from '../../../../tests/support/pi-response';
import { agentConfig } from '../../../agent-cli/src/cli/agent-config';

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
const dir = await mkdtemp(join(tmpdir(), 'voxel-navigation-'));
let manager: AgentManager | undefined;
let agent: Session | undefined, human: Session | undefined;
try {
  await server.listen(0, '127.0.0.1');
  const listing = await matchMaker.createRoom('world', {});
  const room = matchMaker.getLocalRoomById(listing.roomId) as WorldRoom;
  app.get('/world', (_req, res) => res.json({ roomId: listing.roomId }));
  const url = `ws://127.0.0.1:${(http.address() as { port: number }).port}`;
  agent = await new Session(url).join('Navigator', 'ai-agent');
  human = await new Session(url).join('Target', 'human');
  const put = (x: number, y: number, z: number) =>
    room.blocks.set(key({ x, y, z }), { x, y, z, material: 'stone' });
  async function reset() {
    agent!.move(0, 0);
    human!.move(0, 0);
    room.blocks.clear();
    for (let x = -12; x <= 12; x++)
      for (let z = -12; z <= 12; z++) for (let y = 0; y <= 2; y++) put(x, y, z);
    Object.assign(room.state.players.get(agent!.room.sessionId)!, {
      x: 0,
      y: 2.55,
      z: 0,
    });
    Object.assign(room.state.players.get(human!.room.sessionId)!, {
      x: 4,
      y: 2.55,
      z: 0,
    });
    room.state.revision++;
    await delay(150);
  }
  const cases: string[] = [];
  for (const kind of ['wall', 'step', 'far', 'dynamic']) {
    await reset();
    if (kind === 'wall')
      for (let z = -2; z <= 2; z++) for (let y = 3; y <= 6; y++) put(2, y, z);
    if (kind === 'step')
      for (let x = 2; x <= 6; x++) for (let z = -12; z <= 12; z++) put(x, 3, z);
    room.state.revision++;
    const observation = await agent.observe();
    assert(
      observation.navigation!.blocks.length > 500,
      'navigation must not truncate at model limit',
    );
    assert.equal(observation.blocks.length, 500);
    const nav = observation.navigation!;
    const expected = [...room.blocks.values()].filter(
      (b) =>
        b.x >= nav.min.x &&
        b.x <= nav.max.x &&
        b.y >= nav.min.y &&
        b.y <= nav.max.y &&
        b.z >= nav.min.z &&
        b.z <= nav.max.z,
    );
    assert.deepEqual(
      nav.blocks,
      expected,
      'all solids inside bounds must be transmitted',
    );
    const target = {
      type: 'goto' as const,
      x: kind === 'far' ? 11 : 5,
      y: kind === 'step' ? 3.5 : 2.5,
      z: 0,
    };
    let editTimer: ReturnType<typeof setTimeout> | undefined;
    if (kind === 'dynamic')
      editTimer = setTimeout(() => {
        for (let z = -1; z <= 1; z++) for (let y = 3; y <= 6; y++) put(3, y, z);
        room.state.revision++;
      }, 250);
    try {
      const result = await executeAction(
        agent,
        target,
        observation,
        false,
        AbortSignal.timeout(35000),
      );
      assert(result.ok, `${kind}: ${JSON.stringify(result)}`);
      assert('status' in result && result.status === 'arrived');
      const final = await agent.observe();
      assert(
        Math.hypot(final.self.x - target.x, final.self.z - target.z) < 0.18,
      );
      assert(final.motion!.grounded);
      cases.push(kind);
    } finally {
      clearTimeout(editTimer);
    }
  }
  await reset();
  const memory: AgentRunState = { task: newTask('持续跟随') };
  const config = {
    ...agentConfig({ DEEPSEEK_API_KEY: 'fixture' }),
    taskTimeoutMs: 60000,
    intervalMs: 60000,
    intervalMode: 'fixed' as const,
  };
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    return toolResponse([
      {
        name: 'follow',
        arguments: { playerId: human!.room.sessionId, distance: 1.5 },
      },
    ]);
  };
  const controller = new AbortController();
  const following = runAgent(
    agent,
    new AgentRunner(undefined, request),
    config,
    controller.signal,
    () => {},
    memory,
  );
  try {
    await delay(3000);
    assert(memory.follow, 'native tool registers follow');
    let o = await agent.observe();
    assert(Math.abs(o.self.x - 4) <= 1.5, `follow arrival ${o.self.x}`);
    for (let i = 0; i < 8; i++) {
      human.move(1, 0);
      await delay(100);
    }
    human.move(0, 0);
    await delay(2500);
    o = await agent.observe();
    const target = o.players.find((p) => p.id === human!.room.sessionId)!;
    assert(
      Math.abs(o.self.x - target.x) <= 1.6,
      `follow moving target ${JSON.stringify(o.self)} vs ${target.x}`,
    );
    assert.equal(
      calls,
      1,
      'host follows without additional model inference or configured 60s heartbeat delay',
    );
  } finally {
    controller.abort();
    await following;
  }
  const stopped = await agent.observe();
  await delay(300);
  const after = await agent.observe();
  assert(
    Math.abs(stopped.self.x - after.self.x) < 0.05,
    'cancel stops held input',
  );
  assert.equal(
    memory.task!.status,
    'waiting',
    'being near target never completes a continuous task',
  );
  await reset();
  const store = new ProviderStore(join(dir, 'providers.json'));
  await store.load({ DEEPSEEK_API_KEY: 'fixture' });
  manager = new AgentManager(store, url, {
    session: (endpoint) => new Session(endpoint),
    runner: () => new AgentRunner(undefined, request),
    models: async () => ['fixture-model'],
  });
  const managed = manager.create({
    providerId: 'deepseek',
    name: 'Managed navigator',
    goal: '持续跟随',
    intervalMs: 60000,
    maxTurns: 10,
  });
  const view = () => manager!.list().find((a) => a.id === managed.id)!;
  const managedPosition = () => room.state.players.get(view().sessionId!)!;
  const separation = () => {
    const p = managedPosition(),
      h = room.state.players.get(human!.room.sessionId)!;
    return p ? Math.hypot(p.x - h.x, p.z - h.z) : Infinity;
  };
  await until(
    () => separation() <= 1.5 && view().task?.status === 'waiting',
    10000,
  );
  await manager.controlTask(managed.id, 'pause');
  const paused = { x: managedPosition().x, z: managedPosition().z };
  for (let i = 0; i < 8; i++) {
    human.move(1, 0);
    await delay(100);
  }
  human.move(0, 0);
  await delay(300);
  assert.deepEqual({ x: managedPosition().x, z: managedPosition().z }, paused);
  manager.resume(managed.id, {});
  await until(
    () => separation() <= 1.5 && view().task?.status === 'waiting',
    10000,
  );
  await manager.controlTask(managed.id, 'cancel');
  assert.equal(view().task!.status, 'cancelled');
  assert.equal(
    calls,
    2,
    'one inference per host; moving, pause/resume and cancellation need no further inference',
  );
  console.log(
    JSON.stringify({
      passed: cases,
      mapComplete: true,
      follow:
        'native tool + CLI host loop + moving remote player + cancellation',
      modelCalls: calls,
      serverHost:
        'managed follow + 60s configured heartbeat + pause/resume/cancel',
      inference: 'deterministic SSE fixture; real Colyseus/WebSocket/physics',
    }),
  );
} finally {
  await manager?.close();
  await agent?.close();
  await human?.close();
  await server.gracefullyShutdown(false);
  await rm(dir, { recursive: true, force: true });
}

import { createTestServer } from '../helpers/test-server';
/** Opt-in paid-model acceptance test. Uses real AgentManager, chat, WebSocket and physics. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { AgentManager, ProviderStore } from '../../src/modules/agent/manager';
import {
  AgentRunner,
  Session,
  delay,
  until,
  type BatchResult,
} from '@voxel/agent-runtime';
import { key } from '@voxel/shared';

const source = process.env.NAVIGATION_PROVIDERS;
assert(
  source,
  'Set NAVIGATION_PROVIDERS to an existing provider JSON file. This test makes real model requests.',
);
const providers = JSON.parse(await readFile(resolve(source), 'utf8'));
const provider = providers.find(
  (p: { id: string }) =>
    p.id === (process.env.NAVIGATION_PROVIDER || 'deepseek'),
);
assert(provider?.apiKey, 'The selected provider must have a configured key.');
const output = resolve(
  process.env.NAVIGATION_OUTPUT || '../../artifacts/navigation-live-model.json',
);
process.env.DATABASE_URL = '';
process.env.VOICE_PROVIDER = 'mock';
const dir = await mkdtemp(join(tmpdir(), 'voxel-navigation-live-'));
let server: Awaited<ReturnType<typeof createTestServer>> | undefined;
let manager: AgentManager | undefined,
  human: Session | undefined,
  observer: Session | undefined;
const results: unknown[] = [];
const evidence = {
  model: provider.defaultModel,
  provider: provider.type,
  inference: 'real provider; no response fixtures or intent injection',
  world:
    'isolated real Colyseus/WebSocket/physics; production AgentManager chat wake and persistence',
  results,
};
const record = async () => {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2));
};
try {
  const providerPath = join(dir, 'providers.json');
  await writeFile(providerPath, JSON.stringify([provider]), { mode: 0o600 });
  const store = new ProviderStore(providerPath);
  await store.load();
  let calls = 0;
  const actions = new Map<string, unknown>();
  const taskStates = new Set<string>();
  server = await createTestServer({
    directory: dir,
    providers: store,
    agentDependencies: {
      session: (endpoint) => new Session(endpoint),
      models: async () => [provider.defaultModel],
      runner: (_config, endpoint) => ({
        run: async (options) => {
          await new AgentRunner(endpoint, async (input, init) => {
            assert(
              ++calls <= 8,
              'Bound real provider calls to eight per case.',
            );
            return fetch(input, init);
          }).run({
            ...options,
            signal: AbortSignal.any([
              options.signal,
              AbortSignal.timeout(120000),
            ]),
            checkpoint: async () => {
              await options.checkpoint?.();
              const task = options.memory.task;
              if (task) taskStates.add(task.status);
              const batch = options.memory.previous as BatchResult | undefined;
              if (batch?.batchId)
                for (const r of batch.results) {
                  if (r.action.type === 'goto')
                    actions.set(batch.batchId, {
                      action: r.action,
                      status: r.status,
                      result: r.result,
                      task: task && {
                        goal: task.goal,
                        status: task.status,
                        owner: task.owner,
                        privateTo: task.privateTo,
                      },
                    });
                }
            },
          });
        },
      }),
    },
  });
  manager = server.agents;
  const room = server.world,
    url = server.url;
  human = await new Session(url).join('Explorer4', 'human');
  observer = await new Session(url).join('Explorer', 'human');
  const managed = manager.create({
    providerId: provider.id,
    name: 'AI',
    startTask: false,
    intervalMs: 60000,
    maxTurns: 8,
    tokenBudget: 60000,
    taskTimeoutMs: 120000,
    permissions: { move: true, chat: true, place: true, remove: true },
  });
  const view = () => manager!.list().find((a) => a.id === managed.id)!;
  await until(() => view().status === 'idle' && !!view().sessionId, 10000);
  const put = (x: number, y: number, z: number) =>
    room.blocks.set(key({ x, y, z }), { x, y, z, material: 'stone' });
  for (const kind of ['flat', 'cancelled-wall', 'cancelled-step']) {
    calls = 0;
    actions.clear();
    taskStates.clear();
    if (kind.startsWith('cancelled')) {
      await manager.update(managed.id, { goal: `旧任务-${kind}` });
      await manager.controlTask(managed.id, 'cancel');
      assert.equal(view().task?.status, 'cancelled');
    }
    room.blocks.clear();
    for (let x = -12; x <= 12; x++)
      for (let z = -12; z <= 12; z++) for (let y = 0; y <= 2; y++) put(x, y, z);
    if (kind.endsWith('wall'))
      for (let z = -2; z <= 2; z++) for (let y = 3; y <= 6; y++) put(2, y, z);
    if (kind.endsWith('step'))
      for (let x = 2; x <= 6; x++) for (let z = -12; z <= 12; z++) put(x, 3, z);
    const agent = room.state.players.get(view().sessionId!)!;
    const target = room.state.players.get(human.room.sessionId)!;
    const bystander = room.state.players.get(observer.room.sessionId)!;
    Object.assign(agent, { x: 0, y: 2.55, z: 0 });
    Object.assign(target, {
      x: 4,
      y: kind.endsWith('step') ? 3.55 : 2.55,
      z: 0,
    });
    Object.assign(bystander, { x: -4, y: 2.55, z: 0 });
    room.state.revision++;
    await delay(200);
    const xyz = (p: typeof agent) => ({ x: p.x, y: p.y, z: p.z });
    const start = xyz(agent),
      destination = xyz(target);
    const priorStartedAt = view().task?.startedAt;
    const trajectory: ReturnType<typeof xyz>[] = [];
    const timer = setInterval(() => trajectory.push(xyz(agent)), 50);
    const started = Date.now();
    try {
      assert(
        (
          await human.request('chat', {
            text: '到我这里来',
            scope: 'private',
            recipients: [view().sessionId],
          })
        ).ok,
      );
      await until(() => calls > 0 && view().status === 'idle', 125000);
      const final = view();
      const distance = Math.hypot(agent.x - target.x, agent.z - target.z);
      const result = {
        case: kind,
        input: '到我这里来',
        calls,
        ms: Date.now() - started,
        usage: final.usage,
        start,
        destination,
        end: xyz(agent),
        distance,
        task: final.task,
        taskStates: [...taskStates],
        navigation: [...actions.values()],
        lastResponse: final.lastResponse,
        maxDetour: Math.max(...trajectory.map((p) => Math.abs(p.z))),
        maxHeight: Math.max(...trajectory.map((p) => p.y)),
      };
      results.push(result);
      await record();
      console.log(JSON.stringify(result));
      assert.notEqual(
        final.task?.startedAt,
        priorStartedAt,
        'must create a new task',
      );
      assert.equal(final.task?.owner, human.room.sessionId);
      assert.equal(final.task?.status, 'completed');
      assert(taskStates.has('running'), 'must actually start the task');
      assert(actions.size > 0, 'must execute goto, not only chat');
      assert(
        distance < 0.3 && Math.abs(agent.y - target.y) < 0.15,
        'authoritative position must reach the sender',
      );
      assert(
        Math.hypot(agent.x - start.x, agent.z - start.z) > 3.5,
        'must physically move',
      );
      if (kind.endsWith('wall'))
        assert(result.maxDetour > 2.5, 'must route around the wall');
      if (kind.endsWith('step'))
        assert(result.maxHeight > 3.4, 'must jump the step');
      // Verify persisted managed-task records, not only the transient view.
      const archive = JSON.parse(
        await readFile(`${providerPath}.agents.json`, 'utf8'),
      );
      const saved = archive.find((a: { id: string }) => a.id === managed.id);
      assert.equal(saved.runtime.task.status, 'completed');
      assert(
        saved.taskBook.runs.some(
          (r: { source: string; task?: { startedAt: number } }) =>
            r.source === 'chat' && r.task?.startedAt === final.task?.startedAt,
        ),
      );
    } finally {
      clearInterval(timer);
    }
  }
} finally {
  await manager?.close();
  await human?.close();
  await observer?.close();
  await server?.close();
  await rm(dir, { recursive: true, force: true });
}

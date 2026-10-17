import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentManager, ProviderStore } from '../apps/server/src/agent/manager';
import {
  DEFAULT_TASK_LIMITS,
  type TaskPlanDraft,
  type TaskTiming,
  type WorldEvent,
} from '../packages/shared/src/index';
import {
  type Planner,
  type Session,
  type Observation,
  AgentRuntimeError,
} from '@voxel/agent-runtime';
let dir: string, store: ProviderStore, manager: AgentManager;
let now: number;
const response = (
  status: 'completed' | 'running' | 'waiting' = 'completed',
): Awaited<ReturnType<Planner['decide']>> => ({
  actions: [{ type: 'wait' }],
  task: {
    intent: 'continue',
    status,
    summary: '完成一次观察',
    waitFor: status === 'waiting' ? 'world' : undefined,
  },
});
const decide = vi.fn<Planner['decide']>();
function session() {
  const leaves: (() => void)[] = [];
  return {
    join: async () => {},
    close: async () => {
      leaves.forEach((f) => f());
    },
    move: vi.fn(),
    onEvent: undefined as ((event: WorldEvent) => void) | undefined,
    room: {
      sessionId: 'fixture-player',
      onMessage: () => {},
      onLeave: (f: () => void) => leaves.push(f),
      connection: { close: () => {} },
    },
    observe: async () =>
      ({
        self: { id: 'fixture-player' },
        events: [],
        blocks: [],
      }) as unknown as Observation,
    request: vi.fn(async () => ({ ok: true })),
  };
}
let currentSession: ReturnType<typeof session>;
function build() {
  return new AgentManager(store, 'ws://fixture', {
    session: () => {
      currentSession = session();
      return currentSession as unknown as Session;
    },
    planner: () => ({ decide, lastUsage: { tokens: 600, estimated: false } }),
    models: async () => [],
  });
}
const draft = (timing: TaskTiming = { kind: 'immediate' }): TaskPlanDraft => ({
  name: '隔离巡查',
  goal: '观察附近后结束',
  timing,
  timeZone: 'Asia/Shanghai',
  limits: { ...DEFAULT_TASK_LIMITS },
  totalTokenBudget: 500000,
});
async function idle() {
  await vi.waitFor(() => expect(manager.list()[0]?.status).toBe('idle'));
}
async function role() {
  const j = manager.create({
    providerId: 'deepseek',
    name: '隔离角色',
    goal: '',
    startTask: false,
  });
  await idle();
  return j.id;
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'task-plans-'));
  store = new ProviderStore(join(dir, 'providers.json'));
  await store.load({ DEEPSEEK_API_KEY: 'fixture' });
  decide.mockReset().mockImplementation(async () => response());
  now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  manager = build();
});
afterEach(async () => {
  await manager.close().catch(() => {});
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
it('persists immediate runs, deduplicates create and manual requests, and preserves history', async () => {
  const id = await role();
  const p = await manager.createTaskPlan(id, {
    ...draft(),
    requestId: 'create-1',
  });
  await idle();
  expect(
    (await manager.createTaskPlan(id, { ...draft(), requestId: 'create-1' }))
      .id,
  ).toBe(p.id);
  expect(manager.taskRuns(id, p.id).items[0]).toMatchObject({
    status: 'completed',
    totalTokens: 600,
    task: { calls: 1 },
  });
  await manager.controlTaskPlan(id, p.id, 'run', { requestId: 'run-2' });
  await idle();
  await manager.controlTaskPlan(id, p.id, 'run', { requestId: 'run-2' });
  expect(decide).toHaveBeenCalledTimes(2);
  expect(manager.taskRuns(id, p.id).items).toHaveLength(2);
  const disk = JSON.parse(await readFile(`${store.path}.agents.json`, 'utf8'));
  expect(disk[0].taskBook.version).toBe(1);
  expect(disk[0].taskBook.runs).toHaveLength(2);
});
it('reserves durably before inference', async () => {
  const id = await role();
  decide.mockImplementation(async () => {
    const disk = JSON.parse(
      await readFile(`${store.path}.agents.json`, 'utf8'),
    );
    expect(disk[0].taskBook.runs).toHaveLength(1);
    expect(disk[0].taskBook.currentRunId).toBe(disk[0].taskBook.runs[0].id);
    return response();
  });
  await manager.createTaskPlan(id, draft());
  await idle();
  expect(decide).toHaveBeenCalledOnce();
});
it('does not start or retain a reservation when persistence fails', async () => {
  const id = await role();
  await rename(dir, `${dir}-hold`);
  try {
    await expect(manager.createTaskPlan(id, draft())).rejects.toThrow();
    expect(decide).not.toHaveBeenCalled();
    expect(manager.taskPlans(id)).toHaveLength(0);
  } finally {
    await rename(`${dir}-hold`, dir);
  }
});
it('runs one due plan and skips simultaneous plans, without queuing', async () => {
  const id = await role();
  decide.mockImplementation(async () => response('waiting'));
  const a = await manager.createTaskPlan(
    id,
    draft({ kind: 'interval', everyMs: 60000 }),
  );
  const b = await manager.createTaskPlan(
    id,
    draft({ kind: 'interval', everyMs: 60000 }),
  );
  now += 60000;
  await manager.dispatchDue(now);
  await idle();
  expect(manager.taskRuns(id, a.id).items[0].status).toBe('waiting');
  expect(manager.taskRuns(id, b.id).items[0]).toMatchObject({
    status: 'skipped',
    reason: expect.stringContaining('忙碌'),
  });
  await manager.dispatchDue(now);
  expect(decide).toHaveBeenCalledOnce();
  expect(manager.taskRuns(id, b.id).items).toHaveLength(1);
  expect(manager.taskPlans(id).find((p) => p.id === a.id)?.nextRunAt).toBe(
    now + 60000,
  );
});
it('records offline once as missed and recurring as skipped without joining', async () => {
  const id = await role();
  manager.stop(id);
  await vi.waitFor(() => expect(manager.list()[0].status).toBe('stopped'));
  const once = await manager.createTaskPlan(
    id,
    draft({ kind: 'once', at: now + 60000 }),
  );
  const repeat = await manager.createTaskPlan(
    id,
    draft({ kind: 'interval', everyMs: 60000 }),
  );
  now += 60000;
  await manager.dispatchDue(now);
  expect(manager.taskRuns(id, once.id).items[0].status).toBe('missed');
  expect(manager.taskRuns(id, repeat.id).items[0].status).toBe('skipped');
  expect(decide).not.toHaveBeenCalled();
  expect(manager.list()[0].sessionId).toBeUndefined();
  await expect(
    manager.controlTaskPlan(id, once.id, 'run', { requestId: 'offline' }),
  ).rejects.toThrow('离线');
});
it('separates plan pause, run pause, edits and resumption while preserving snapshots and usage', async () => {
  const id = await role();
  decide.mockImplementation(async () => response('waiting'));
  const p = await manager.createTaskPlan(
    id,
    draft({ kind: 'interval', everyMs: 60000 }),
  );
  await manager.controlTaskPlan(id, p.id, 'run', { requestId: 'manual' });
  await idle();
  const run = manager.taskRuns(id, p.id).items[0];
  expect(manager.taskPlans(id)[0].nextRunAt).toBe(now + 60000);
  await manager.controlTaskPlan(id, p.id, 'pause');
  expect(manager.taskRuns(id, p.id).items[0].status).toBe('waiting');
  await manager.updateTaskPlan(id, p.id, {
    ...draft({ kind: 'interval', everyMs: 120000 }),
    goal: '新的未来目标',
    limits: { ...DEFAULT_TASK_LIMITS, maxTurns: 20 },
  });
  expect(manager.taskRuns(id, p.id).items[0].snapshot).toEqual(run.snapshot);
  await manager.controlTaskRun(id, run.id, 'pause');
  const other = await manager.createTaskPlan(id, draft());
  await idle();
  expect(manager.taskRuns(id, other.id).items[0].status).toBe('waiting');
  await expect(manager.controlTaskRun(id, run.id, 'resume')).rejects.toThrow(
    '忙碌',
  );
  await manager.controlTaskRun(
    id,
    manager.taskRuns(id, other.id).items[0].id,
    'cancel',
  );
  decide.mockImplementation(async () => response());
  await manager.controlTaskRun(id, run.id, 'resume');
  await idle();
  expect(manager.taskRuns(id, p.id).items[0]).toMatchObject({
    status: 'completed',
    totalTokens: 1200,
    task: { calls: 2, goal: run.snapshot.goal },
  });
  expect(manager.taskPlans(id).find((x) => x.id === p.id)?.state).toBe(
    'paused',
  );
  now += 300000;
  await manager.controlTaskPlan(id, p.id, 'resume');
  expect(
    manager.taskPlans(id).find((x) => x.id === p.id)!.nextRunAt,
  ).toBeGreaterThan(now);
});
it('enforces per-run and lifetime budgets including manual work, and extension never erases usage', async () => {
  const id = await role();
  decide.mockImplementation(async () => response('running'));
  const p = await manager.createTaskPlan(id, {
    ...draft({ kind: 'interval', everyMs: 60000 }),
    limits: { ...DEFAULT_TASK_LIMITS, maxTurns: 1 },
    totalTokenBudget: 1000,
  });
  await manager.controlTaskPlan(id, p.id, 'run', { requestId: 'first' });
  await idle();
  let run = manager.taskRuns(id, p.id).items[0];
  expect(run.status).toBe('budget');
  expect(manager.taskPlans(id)[0].state).toBe('paused');
  await expect(manager.controlTaskRun(id, run.id, 'resume')).rejects.toThrow(
    '额度',
  );
  await manager.controlTaskRun(id, run.id, 'resume', { maxTurns: 10 });
  await idle();
  run = manager.taskRuns(id, p.id).items[0];
  expect(run.totalTokens).toBe(1200);
  expect(run.task?.calls).toBe(2);
  expect(run.status).toBe('budget');
  await expect(manager.controlTaskRun(id, run.id, 'resume')).rejects.toThrow(
    '累计额度',
  );
  await manager.controlTaskPlan(id, p.id, 'extend', { tokens: 1000 });
  expect(manager.taskPlans(id)[0]).toMatchObject({
    spentTokens: 1200,
    totalTokenBudget: 2000,
    state: 'paused',
  });
  await manager.controlTaskRun(id, run.id, 'cancel');
  await manager.controlTaskPlan(id, p.id, 'resume');
  expect(manager.taskPlans(id)[0].spentTokens).toBe(1200);
});
it('pauses the plan after an execution error without occupying the role', async () => {
  const id = await role();
  const p = await manager.createTaskPlan(
    id,
    draft({ kind: 'interval', everyMs: 60000 }),
  );
  decide.mockRejectedValueOnce(new AgentRuntimeError('fixture', true));
  await manager.controlTaskPlan(id, p.id, 'run', { requestId: 'err' });
  await vi.waitFor(() => expect(manager.list()[0].status).toBe('failed'));
  expect(manager.taskPlans(id)[0].state).toBe('paused');
  expect(manager.taskRuns(id, p.id).items[0].status).toBe('failed');
  await manager.createTaskPlan(id, draft());
  await idle();
  expect(decide).toHaveBeenCalledTimes(2);
});
it('restart preserves paused progress and skips missed schedules without calling a model', async () => {
  const id = await role();
  decide.mockImplementation(async () => response('waiting'));
  const p = await manager.createTaskPlan(id, draft());
  await idle();
  const r = manager.taskRuns(id, p.id).items[0];
  const future = await manager.createTaskPlan(
    id,
    draft({ kind: 'interval', everyMs: 60000 }),
  );
  await manager.close();
  now += 180000;
  manager = build();
  decide.mockClear();
  await manager.load();
  expect(decide).not.toHaveBeenCalled();
  expect(manager.taskRuns(id, p.id).items[0]).toMatchObject({
    id: r.id,
    status: 'paused',
    totalTokens: 600,
    task: { calls: 1 },
  });
  expect(manager.taskPlans(id).find((x) => x.id === p.id)?.state).toBe(
    'paused',
  );
  expect(manager.taskRuns(id, future.id).items[0].status).toBe('skipped');
  await manager.dispatchDue(now);
  expect(decide).not.toHaveBeenCalled();
});
it('backs up and migrates old records without inference, preserving checkpoints and terminal state', async () => {
  const id = await role();
  const p = await manager.createTaskPlan(id, draft());
  await idle();
  await manager.close();
  const path = `${store.path}.agents.json`;
  const archive = JSON.parse(await readFile(path, 'utf8'));
  delete archive[0].taskBook;
  const old = JSON.stringify(archive);
  await writeFile(path, old);
  manager = build();
  decide.mockClear();
  await manager.load();
  expect(await readFile(`${path}.before-task-plans.bak`, 'utf8')).toBe(old);
  const migrated = manager.taskPlans(id);
  expect(migrated).toHaveLength(1);
  expect(migrated[0].latestRun).toMatchObject({
    status: 'completed',
    totalTokens: 600,
  });
  expect(decide).not.toHaveBeenCalled();
  const saved = JSON.parse(await readFile(path, 'utf8'));
  expect(saved[0].taskBook.runs[0].runtime.previous).toBeDefined();
  expect(p.goal).toBe(migrated[0].goal);
});
it('archives only ended runs and paginates independent history', async () => {
  const id = await role();
  const p = await manager.createTaskPlan(id, draft());
  await idle();
  for (let i = 0; i < 21; i++) {
    await manager.controlTaskPlan(id, p.id, 'run', { requestId: `page-${i}` });
    await idle();
  }
  expect(manager.taskRuns(id, p.id).items).toHaveLength(20);
  expect(manager.taskRuns(id, p.id).nextOffset).toBe(20);
  expect(manager.taskRuns(id, p.id, 20).items).toHaveLength(2);
  await manager.controlTaskPlan(id, p.id, 'archive');
  expect(manager.taskPlans(id)[0].state).toBe('archived');
  expect(manager.taskRuns(id, p.id).items).toHaveLength(20);
});

it('allows another occurrence after a manual pause without losing the older resumable run', async () => {
  const id = await role();
  decide.mockImplementation(async () => response('waiting'));
  const p = await manager.createTaskPlan(id, draft());
  await idle();
  const first = manager.taskRuns(id, p.id).items[0];
  await manager.controlTaskRun(id, first.id, 'pause');
  decide.mockImplementation(async () => response());
  await manager.controlTaskPlan(id, p.id, 'run', {
    requestId: 'second-independent',
  });
  await idle();
  expect(manager.taskRuns(id, p.id).items).toHaveLength(2);
  expect(manager.taskRuns(id, p.id).active[0]).toMatchObject({
    id: first.id,
    status: 'paused',
    totalTokens: 600,
  });
  await expect(manager.controlTaskPlan(id, p.id, 'archive')).rejects.toThrow(
    '结束',
  );
  await manager.controlTaskRun(id, first.id, 'resume');
  await idle();
  expect(
    manager.taskRuns(id, p.id).items.find((r) => r.id === first.id)
      ?.totalTokens,
  ).toBe(1200);
});
it('restores unconfirmed action history as unknown and expires private runs without executing them', async () => {
  const id = await role();
  decide.mockImplementation(async () => response('waiting'));
  const p = await manager.createTaskPlan(id, draft());
  await idle();
  await manager.close();
  const path = `${store.path}.agents.json`,
    archive = JSON.parse(await readFile(path, 'utf8'));
  const record = archive[0].taskBook.runs[0];
  const previous = {
    actions: [{ type: 'edit', x: 1, y: 3, z: 1, material: 'wood' }],
    results: [
      {
        action: { type: 'edit', x: 1, y: 3, z: 1, material: 'wood' },
        status: 'executing',
      },
    ],
    remaining: [],
    ok: false,
    stopReason: 'executing',
  };
  record.runtime.previous = previous;
  archive[0].runtime.previous = previous;
  record.runtime.task.privateTo = 'expired-player';
  archive[0].runtime.task.privateTo = 'expired-player';
  record.runtime.unfinishedBuild = {
    action: { type: 'build', blocks: [{ x: 1, y: 3, z: 1, material: 'wood' }] },
    result: {
      ok: false,
      total: 1,
      completed: 0,
      skipped: 0,
      remaining: [{ x: 1, y: 3, z: 1, material: 'wood' }],
      failures: [],
    },
  };
  archive[0].runtime.unfinishedBuild = record.runtime.unfinishedBuild;
  await writeFile(path, JSON.stringify(archive));
  manager = build();
  decide.mockClear();
  await manager.load();
  const run = manager.taskRuns(id, p.id).items[0];
  expect(run.requiresReassignment).toBe(true);
  expect(run.status).toBe('needs_input');
  expect(decide).not.toHaveBeenCalled();
  await expect(manager.controlTaskRun(id, run.id, 'resume')).rejects.toThrow(
    '私聊',
  );
  const restored = JSON.parse(await readFile(path, 'utf8'));
  expect(restored[0].taskBook.runs[0].runtime.previous.results[0].status).toBe(
    'unknown',
  );
  expect(
    restored[0].taskBook.runs[0].runtime.unfinishedBuild.result.remaining,
  ).toHaveLength(1);
});

it('registers chat tasks as one-time executions and rejects replacement of active work', async () => {
  const id = await role();
  const addressed = (seq: number): WorldEvent => ({
    seq,
    actor: 'owner',
    actorKind: 'human',
    type: 'chat',
    at: now,
    data: {
      scope: 'private',
      recipients: ['fixture-player'],
      text: '请观察营地',
      kind: 'text',
      name: 'Owner',
    },
  });
  decide.mockImplementation(async () => ({
    actions: [{ type: 'wait' }],
    task: {
      intent: 'task',
      goal: '聊天安排',
      status: 'waiting',
      waitFor: 'world',
      summary: '观察后等待',
    },
  }));
  currentSession.onEvent!(addressed(1));
  await vi.waitFor(() => expect(manager.taskPlans(id)).toHaveLength(1));
  await idle();
  const plan = manager.taskPlans(id)[0];
  expect(plan.timing.kind).toBe('immediate');
  expect(plan.latestRun).toMatchObject({
    source: 'chat',
    totalTokens: 600,
    task: { privateTo: 'owner' },
  });
  currentSession.onEvent!(addressed(2));
  await vi.waitFor(() => expect(decide).toHaveBeenCalledTimes(2));
  await idle();
  expect(manager.taskPlans(id)).toHaveLength(1);
  expect(manager.taskRuns(id, plan.id).items).toHaveLength(1);
  expect(manager.taskRuns(id, plan.id).items[0].task?.goal).toBe('聊天安排');
  expect(
    manager.list()[0].logs.some((log) => log.includes('已有正在执行')),
  ).toBe(true);
});

it('unchecked limits survive restart, resume and scheduled/manual executions without capping cumulative usage', async () => {
  const id = await role();
  const p = await manager.createTaskPlan(id, {
    ...draft({ kind: 'interval', everyMs: 60000 }),
    limits: {
      enabled: false,
      maxTurns: 1,
      tokenBudget: 1000,
      taskTimeoutMs: 60000,
    },
    totalTokenBudget: 1000,
  });
  decide.mockResolvedValueOnce(response('waiting'));
  await manager.controlTaskPlan(id, p.id, 'run', {
    requestId: 'unlimited-first',
  });
  await idle();
  const r = manager.taskRuns(id, p.id).items[0];
  expect(r.status).toBe('waiting');
  await manager.controlTaskRun(id, r.id, 'pause');
  await manager.close();
  manager = build();
  await manager.load();
  await idle();
  expect(manager.taskPlans(id)[0].limits.enabled).toBe(false);
  await manager.controlTaskRun(id, r.id, 'resume');
  await idle();
  expect(manager.taskRuns(id, p.id).items[0]).toMatchObject({
    status: 'completed',
    totalTokens: 1200,
    task: { calls: 2 },
    snapshot: { limits: { enabled: false } },
  });
  await manager.controlTaskPlan(id, p.id, 'run', {
    requestId: 'unlimited-again',
  });
  await idle();
  now += 60000;
  await manager.dispatchDue(now);
  await idle();
  expect(manager.taskPlans(id)[0]).toMatchObject({
    state: 'enabled',
    spentTokens: 2400,
  });
  expect(manager.taskRuns(id, p.id).items).toHaveLength(3);
});

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createTestServer } from '../helpers/test-server';
import { GatewayClient, type SocketLike } from '@voxel/gateway-client';
import { Session, until } from '@voxel/agent-runtime';
const token = 'fixture-gateway-token-for-tests',
  origin = 'http://127.0.0.1:5188';
const server = await createTestServer({
  origin,
  agentDependencies: {
    session: (url) => new Session(url),
    models: async () => ['fixture'],
    runner: () => ({
      async run(o) {
        if (o.memory.task) {
          o.memory.task.status = 'waiting';
          o.memory.task.reason = 'fixture';
        }
        await o.checkpoint?.();
      },
    }),
  },
});
const clients: GatewayClient[] = [];
const connect = (secret = token) => {
  const c = new GatewayClient({
    url: server.url + '/agents/gateway',
    token: () => secret,
    socket: (u) => new WebSocket(u, { origin }) as unknown as SocketLike,
    reconnect: false,
  });
  clients.push(c);
  return c;
};
const http = (path: string, method = 'GET', body?: unknown, key?: string) =>
  fetch(server.httpUrl + path, {
    method,
    headers: {
      Origin: origin,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
try {
  assert.equal(
    (await fetch(server.httpUrl + '/agents', { headers: { Origin: origin } }))
      .status,
    401,
  );
  assert.equal(
    (
      await fetch(server.httpUrl + '/agents', {
        headers: { Origin: 'https://wrong', Authorization: `Bearer ${token}` },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(server.httpUrl + '/agents', {
        headers: { Authorization: token },
      })
    ).status,
    401,
  );
  assert.equal(
    (await fetch(server.httpUrl + '/voice/asr/services')).status,
    401,
  );
  assert.equal(
    (
      await fetch(server.httpUrl + '/voice/asr/services', {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status,
    200,
  );
  const bad = connect('wrong');
  await assert.rejects(bad.connect());
  bad.close();
  const c = connect(),
    other = connect();
  await Promise.all([c.connect(), other.connect()]);
  const events: any[] = [];
  other.onEvent((e) => events.push(e));
  await other.subscribe({ scope: 'all' });
  await until(() => events.length > 0);
  const value = {
    providerId: 'deepseek',
    name: 'Gateway fixture',
    goal: '',
    startTask: false,
  };
  const first = await c.request<any>(
    'agents.create',
    { value },
    { commandId: 'create-stable' },
  );
  const response = await http('/agents', 'POST', value, 'create-stable');
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, first.id);
  assert.equal((await c.request<any[]>('agents.list')).length, 1);
  await assert.rejects(
    c.request(
      'agents.create',
      { value: { ...value, name: 'different' } },
      { commandId: 'create-stable' },
    ),
  );
  await until(() => server.agents.list()[0].status === 'idle');
  const current = await c.request<any>('agents.get', { agentId: first.id });
  await c.request(
    'tasks.assign',
    {
      agentId: first.id,
      expectedTask: current.taskIdentity,
      value: { goal: '等待' },
    },
    { commandId: 'assign' },
  );
  await until(() => server.agents.list()[0].task?.status === 'waiting');
  const duplicateTask = await http(
    `/agents/${first.id}/task`,
    'POST',
    { goal: '等待' },
    'assign',
  );
  assert.equal(
    duplicateTask.status,
    200,
    'RPC and HTTP share one task command receipt',
  );

  await assert.rejects(
    c.request(
      'tasks.cancel',
      {
        agentId: first.id,
        expectedTask: { id: 'old', revision: 0, startedAt: 0 },
      },
      { commandId: 'stale' },
    ),
  );
  assert.equal(
    (await c.request<any>('commands.get', { commandId: 'stale' })).state,
    'rejected',
  );
  const task = await c.request<any>('agents.get', { agentId: first.id });
  await c.request(
    'tasks.pause',
    { agentId: first.id, expectedTask: task.taskIdentity },
    { commandId: 'pause' },
  );
  assert.equal(server.agents.list()[0].task?.status, 'paused');
  const updated = await c.request<any>('agents.get', { agentId: first.id });
  await c.request(
    'tasks.resume',
    { agentId: first.id, expectedTask: updated.taskIdentity },
    { commandId: 'resume' },
  );
  await until(() => server.agents.list()[0].task?.status === 'waiting');
  c.close();
  assert.equal(server.agents.list()[0].task?.status, 'waiting');
  assert(server.agents.list()[0].sessionId);
  const read = await http('/agents');
  assert.equal(read.status, 200);
  assert.equal((await read.json())[0].id, first.id);
  await until(() => events.some((e) => e.event === 'changed'));
  assert(events.every((e, i) => e.seq === i + 1));
  assert(!JSON.stringify(events).includes(token));
  assert(!JSON.stringify(events).includes('fixture-only'));
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(
          new URL(
            '../../../agent-cli/src/cli/agent-control.ts',
            import.meta.url,
          ),
        ),
        'status',
        first.id,
        '--url',
        server.url + '/agents/gateway',
        '--json',
      ],
      {
        env: { ...process.env, AGENT_GATEWAY_TOKEN: token },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '',
      err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve(out) : reject(Error(err)),
    );
  });
  assert.equal(JSON.parse(output).id, first.id);
  assert(
    server.agents.list()[0].sessionId,
    'CLI exit must not stop hosted agent',
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(
          new URL(
            '../../../agent-cli/src/cli/agent-control.ts',
            import.meta.url,
          ),
        ),
        'watch',
        first.id,
        '--url',
        server.url + '/agents/gateway',
        '--json',
      ],
      {
        env: { ...process.env, AGENT_GATEWAY_TOKEN: token },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let ready = false,
      error = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(Error('CLI watch did not exit'));
    }, 10000);
    child.stdout.on('data', (data) => {
      if (!ready && String(data).includes('snapshot')) {
        ready = true;
        child.kill('SIGINT');
      }
    });
    child.stderr.on('data', (data) => (error += data));
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (ready && code === 0) resolve();
      else reject(Error(error || `watch exited ${code}`));
    });
  });
  assert(
    server.agents.list()[0].sessionId,
    'watch Ctrl+C must not stop the hosted Agent',
  );
  const latest = await other.request<any>('agents.get', { agentId: first.id });
  await other.request(
    'tasks.cancel',
    { agentId: first.id, expectedTask: latest.taskIdentity },
    { commandId: 'cancel' },
  );
  assert.equal(server.agents.list()[0].task?.status, 'cancelled');
  const second = await other.request<any>(
    'agents.create',
    { value: { ...value, name: 'Second', joinWorld: false } },
    { commandId: 'second' },
  );
  const draft = {
    name: 'Global plan',
    goal: '观察世界',
    timing: { kind: 'interval', everyMs: 3600000 },
    timeZone: 'UTC',
    limits: { maxSteps: 20, maxTokens: 20000, maxRuntimeMs: 600000 },
    totalTokenBudget: 100000,
  };
  const planned = await other.request<any>(
    'plans.create',
    { agentId: first.id, value: draft },
    { commandId: 'global-plan' },
  );
  const duplicatePlan = await http(
    `/tasks`,
    'POST',
    { ...draft, agentId: first.id },
    'global-plan',
  );
  assert.equal(duplicatePlan.status, 201);
  assert.equal((await duplicatePlan.json()).id, planned.id);
  assert.equal(
    (await other.request<any>('plans.list', { search: 'Global plan' })).total,
    1,
  );
  const unsubscribePlans = await other.subscribe({ scope: 'plans' });
  const assigned = await other.request<any>(
    'plans.reassign',
    {
      planId: planned.id,
      targetAgentId: second.id,
      expectedPlanRevision: planned.revision,
    },
    { commandId: 'reassign-plan' },
  );
  assert.equal(assigned.agentId, second.id);
  assert.equal(assigned.state, 'paused');
  await assert.rejects(
    other.request(
      'plans.control',
      {
        planId: planned.id,
        operation: 'resume',
        expectedPlanRevision: planned.revision,
      },
      { commandId: 'stale-plan' },
    ),
  );
  assert.equal(
    (
      await http(`/tasks/${planned.id}/pause`, 'POST', {
        agentId: first.id,
      })
    ).status,
    409,
  );
  await other.request(
    'agents.delete',
    { agentId: second.id },
    { commandId: 'delete-second' },
  );
  const retained = await other.request<any>('plans.get', {
    planId: planned.id,
  });
  assert.equal(retained.agentId, undefined);
  assert.equal(retained.state, 'paused');
  assert.equal(retained.agentName, 'Second');
  assert.equal(
    (await other.request<any>('plans.list', { state: 'unassigned' })).total,
    1,
  );
  assert.equal(
    (await other.request<any>('runs.list', { planId: planned.id })).total,
    0,
  );
  await until(() =>
    events.some((e) => e.event === 'changed' && e.data?.resource === 'plans'),
  );
  unsubscribePlans();
  console.log(
    'PASS Gateway: authenticated RPC/HTTP parity, cross-transport deduplication, revision conflicts, global plans/reassignment/deletion, subscriptions, task controls, disconnect survival, CLI state and exit.',
  );
} finally {
  for (const c of clients) c.close();
  await server.close();
}

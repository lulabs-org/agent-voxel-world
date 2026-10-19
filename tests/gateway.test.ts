import { describe, it, expect, vi } from 'vitest';
import { CommandRouter, AgentGateway } from '@voxel/agent-gateway';
import {
  parseConnect,
  parseRequest,
  GatewayError,
} from '@voxel/gateway-protocol';
import {
  GatewayClient,
  UnknownOutcome,
  type SocketLike,
} from '@voxel/gateway-client';
import { ProviderStore } from '../apps/server/src/modules/agent/provider-store';
import { gatewaySocket } from '../apps/server/src/modules/gateway/socket';
import { EventEmitter } from 'node:events';
import { GatewayAuth } from '../apps/server/src/modules/gateway/auth';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

describe('gateway command boundary', () => {
  it('coalesces concurrent commands and rejects reused IDs with different payloads', async () => {
    const router = new CommandRouter();
    let finish!: (v: unknown) => void;
    const action = vi.fn(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const a = router.run('same', { a: 1, b: 2 }, 'agent', action),
      b = router.run('same', { b: 2, a: 1 }, 'agent', action);
    await Promise.resolve();
    await Promise.resolve();
    expect(action).toHaveBeenCalledTimes(1);
    expect(router.get('same').state).toBe('pending');
    expect(() => router.run('same', { a: 2 }, 'agent', action)).toThrow('不同');
    finish('saved');
    expect(await a).toBe('saved');
    expect(await b).toBe('saved');
    expect(router.get('same')).toMatchObject({
      state: 'committed',
      result: 'saved',
    });
  });
  it('serializes state commits per Agent while allowing different Agents', async () => {
    const router = new CommandRouter(),
      order: string[] = [];
    let release!: () => void;
    const a = router.run('1', {}, 'a', async () => {
      order.push('a1');
      await new Promise<void>((r) => (release = r));
    });
    const b = router.run('2', {}, 'a', async () => order.push('a2'));
    await router.run('3', {}, 'b', async () => order.push('b'));
    expect(order).toEqual(['a1', 'b']);
    release();
    await Promise.all([a, b]);
    expect(order.at(-1)).toBe('a2');
  });
  it('retains rejection receipts, hides internal errors, and expires completed commands only', async () => {
    const router = new CommandRouter();
    await expect(
      router.run('bad', {}, 'a', async () => {
        throw Error('secret');
      }),
    ).rejects.toThrow();
    expect(JSON.stringify(router.get('bad'))).not.toContain('secret');
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 600001);
    expect(router.get('bad').state).toBe('unknown');
    clock.mockRestore();
  });
  it('validates handshake, method parameters and write IDs', () => {
    expect(() =>
      parseConnect({ type: 'connect', version: 2, client: 'web', token: 'x' }),
    ).toThrow();
    expect(() =>
      parseRequest({
        type: 'req',
        id: '1',
        method: 'agents.delete',
        params: { agentId: 'a' },
      }),
    ).toThrow('commandId');
    expect(() =>
      parseRequest({
        type: 'req',
        id: '1',
        method: 'agents.get',
        params: { agentId: 'a', authority: 'operator' },
      }),
    ).toThrow();
    expect(() =>
      parseRequest({
        type: 'req',
        id: '1',
        method: 'plans.control',
        commandId: 'c',
        params: { agentId: 'a', planId: 'p', operation: 'destroy' },
      }),
    ).toThrow();
  });
  it('generates private stable credentials and never treats wildcard Origin as authorization', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-auth-'));
    try {
      const tokenFile = join(dir, 'token');
      const auth = await GatewayAuth.load({
        tokenFile,
        origins: ['http://localhost'],
      });
      const token = (await readFile(tokenFile, 'utf8')).trim();
      expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
      expect(auth.verify(token)).toBe(true);
      expect(auth.verify('wrong')).toBe(false);
      expect(auth.acceptsOrigin('https://other')).toBe(false);
      expect(auth.acceptsOrigin(undefined)).toBe(true);
      const next = await GatewayAuth.load({ tokenFile, origins: [] });
      expect(next.verify(token)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
class FakeSocket implements SocketLike {
  readyState = 1;
  listeners = new Map<string, ((e: any) => void)[]>();
  sent: any[] = [];
  addEventListener(t: string, f: (e: any) => void) {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]);
  }
  emit(t: string, e: any = {}) {
    for (const f of this.listeners.get(t) ?? []) f(e);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  frame(value: unknown) {
    this.emit('message', { data: JSON.stringify(value) });
  }
}
async function connected() {
  const socket = new FakeSocket(),
    client = new GatewayClient({
      url: 'ws://test',
      token: () => 'secret',
      socket: () => socket,
      reconnect: false,
    });
  const ready = client.connect();
  socket.emit('open');
  socket.frame({
    type: 'connected',
    version: 1,
    gatewayEpoch: 'epoch',
    capabilities: [],
  });
  await ready;
  return { client, socket };
}
describe('gateway client recovery', () => {
  it('correlates out-of-order responses and never resends a disconnected mutation', async () => {
    const { client, socket } = await connected();
    const a = client.request('agents.list'),
      b = client.request('providers.list');
    await Promise.resolve();
    const req = socket.sent.filter((v) => v.type === 'req');
    socket.frame({ type: 'res', id: req[1].id, ok: true, result: ['b'] });
    socket.frame({ type: 'res', id: req[0].id, ok: true, result: ['a'] });
    expect(await a).toEqual(['a']);
    expect(await b).toEqual(['b']);
    const write = client.request(
      'agents.create',
      { value: {} },
      { commandId: 'stable' },
    );
    await Promise.resolve();
    socket.close();
    await expect(write).rejects.toBeInstanceOf(UnknownOutcome);
    expect(socket.sent.filter((v) => v.commandId === 'stable')).toHaveLength(1);
    client.close();
  });
  it('authentication failure closes the client without retrying', async () => {
    const socket = new FakeSocket(),
      client = new GatewayClient({
        url: 'ws://test',
        token: () => 'wrong',
        socket: () => socket,
      });
    const ready = client.connect();
    socket.emit('open');
    socket.frame({
      type: 'error',
      error: { code: 'UNAUTHORIZED', status: 401, message: 'denied' },
    });
    await expect(ready).rejects.toBeInstanceOf(GatewayError);
    expect(client.state).toBe('unauthorized');
    client.close();
  });
  it('requires contiguous event sequences and closes on a gap', async () => {
    const { client, socket } = await connected();
    const event = vi.fn();
    client.onEvent(event);
    socket.frame({
      type: 'event',
      subscriptionId: 's',
      seq: 1,
      event: 'snapshot',
      data: {},
    });
    socket.frame({
      type: 'event',
      subscriptionId: 's',
      seq: 3,
      event: 'changed',
      data: {},
    });
    expect(event).toHaveBeenCalledTimes(1);
    expect(socket.readyState).toBe(3);
    client.close();
  });
});
it('keeps protocol/client browser safe and hosted core independent of applications and transports', () => {
  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? files(`${dir}/${e.name}`)
        : e.name.endsWith('.ts')
          ? [`${dir}/${e.name}`]
          : [],
    );
  }
  for (const pkg of ['agent-gateway', 'gateway-protocol', 'gateway-client'])
    for (const file of files(`packages/${pkg}/src`)) {
      const s = readFileSync(file, 'utf8');
      expect(s, file).not.toMatch(/from ['"].*(?:apps\/|express|['"]ws['"])/);
      if (pkg !== 'agent-gateway')
        expect(s, file).not.toMatch(
          /from ['"](?:node:|@earendil|@voxel\/agent-runtime)/,
        );
    }
});

it('does not acknowledge a failed creation, publish unsaved state or enter the world', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gateway-storage-'));
  const providers = new ProviderStore(join(directory, 'providers.json'));
  await providers.load({ DEEPSEEK_API_KEY: 'fixture-only' });
  const world = vi.fn();
  let fail = true;
  const gateway = new AgentGateway(
    providers,
    'ws://fixture',
    {
      session: world,
      runner: () => ({ run: async () => {} }),
      models: async () => [],
    },
    undefined,
    {
      load: async () => undefined,
      save: async () => {
        if (fail) throw Error('disk full');
      },
    },
  );
  const events = vi.fn();
  gateway.events.on(events);
  try {
    await expect(
      gateway.dispatch(
        'agents.create',
        {
          value: { providerId: 'deepseek', name: 'Failure', startTask: false },
        },
        'fail-create',
      ),
    ).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(world).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
    expect(await gateway.dispatch('agents.list', {})).toEqual([]);
    expect(gateway.commands.get('fail-create').state).toBe('rejected');
  } finally {
    fail = false;
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

class ServerSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  frames: any[] = [];
  closeCode?: number;
  send(raw: string) {
    this.frames.push(JSON.parse(raw));
  }
  close(code: number) {
    this.closeCode = code;
    this.readyState = 3;
    this.emit('close');
  }
  frame(value: unknown) {
    this.emit('message', Buffer.from(JSON.stringify(value)), false);
  }
}
function serverSocket(gateway: any, origin = 'http://localhost') {
  const socket = new ServerSocket();
  gatewaySocket(
    gateway,
    new GatewayAuth('fixture-gateway-token-for-tests', ['http://localhost']),
    'epoch',
    socket as any,
    { headers: { origin } } as any,
  );
  return socket;
}
const hello = {
  type: 'connect',
  version: 1,
  client: 'web',
  token: 'fixture-gateway-token-for-tests',
};
it('buffers changes during a subscription snapshot and disconnects slow clients', async () => {
  const { GatewayEvents } = await import(
    '../packages/agent-gateway/src/events'
  );
  const events = new GatewayEvents();
  let resolve!: (value: unknown) => void;
  const gateway = {
    events,
    dispatch: vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    ),
  };
  const socket = serverSocket(gateway);
  socket.frame(hello);
  socket.frame({
    type: 'req',
    id: 's',
    method: 'gateway.subscribe',
    params: { scope: 'agent', agentId: 'a' },
  });
  events.publish('agents', ['a']);
  resolve({ id: 'a' });
  await vi.waitFor(() =>
    expect(socket.frames.filter((f) => f.type === 'event')).toHaveLength(2),
  );
  expect(
    socket.frames
      .filter((f) => f.type === 'event')
      .map((f) => [f.event, f.seq]),
  ).toEqual([
    ['snapshot', 1],
    ['changed', 2],
  ]);
  socket.bufferedAmount = 1048577;
  events.publish('agents', ['a']);
  expect(socket.closeCode).toBe(1013);
});
it('rejects missing handshake, unsupported version, Origin, malformed/oversize frames and handshake timeout', () => {
  vi.useFakeTimers();
  try {
    const gateway = {};
    for (const frame of [
      { type: 'req', id: 'x', method: 'agents.list', params: {} },
      { ...hello, version: 2 },
      { ...hello, token: 'wrong' },
    ]) {
      const socket = serverSocket(gateway);
      socket.frame(frame);
      expect(socket.closeCode).toBe(1008);
    }
    const foreign = serverSocket(gateway, 'https://foreign');
    foreign.frame(hello);
    expect(foreign.closeCode).toBe(1008);
    const large = serverSocket(gateway);
    large.emit('message', Buffer.alloc(32769), false);
    expect(large.closeCode).toBe(1008);
    const malformed = serverSocket(gateway);
    malformed.emit('message', Buffer.from('{'), false);
    expect(malformed.closeCode).toBe(1008);
    const timeout = serverSocket(gateway);
    vi.advanceTimersByTime(5001);
    expect(timeout.closeCode).toBe(1008);
  } finally {
    vi.useRealTimers();
  }
});
it('restores an initially interrupted subscription after reconnect without sending writes', async () => {
  const sockets: FakeSocket[] = [];
  const client = new GatewayClient({
    url: 'ws://fixture',
    token: () => 'fixture',
    socket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  try {
    const first = client.subscribe({ scope: 'agents' });
    sockets[0].close();
    await expect(first).rejects.toThrow();
    const connected = client.connect();
    sockets[1].emit('open');
    sockets[1].frame({
      type: 'connected',
      version: 1,
      gatewayEpoch: 'new',
      capabilities: [],
    });
    await connected;
    await vi.waitFor(() =>
      expect(
        sockets[1].sent.some((f) => f.method === 'gateway.subscribe'),
      ).toBe(true),
    );
    const request = sockets[1].sent.find(
      (f) => f.method === 'gateway.subscribe',
    );
    sockets[1].frame({
      type: 'res',
      id: request.id,
      ok: true,
      result: { subscriptionId: 'new-sub' },
    });
    expect(sockets[1].sent.filter((f) => f.type === 'req')).toHaveLength(1);
  } finally {
    client.close();
  }
});

it('queries an unknown command after a new gateway epoch without replaying the mutation', async () => {
  const sockets: FakeSocket[] = [];
  const client = new GatewayClient({
    url: 'ws://fixture',
    token: () => 'fixture',
    reconnect: false,
    socket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  try {
    const first = client.connect();
    sockets[0].emit('open');
    sockets[0].frame({
      type: 'connected',
      version: 1,
      gatewayEpoch: 'old',
      capabilities: [],
    });
    await first;
    const write = client.request(
      'agents.create',
      { value: {} },
      { commandId: 'uncertain' },
    );
    await Promise.resolve();
    sockets[0].close();
    await expect(write).rejects.toBeInstanceOf(UnknownOutcome);
    const second = client.connect();
    sockets[1].emit('open');
    sockets[1].frame({
      type: 'connected',
      version: 1,
      gatewayEpoch: 'new',
      capabilities: [],
    });
    await second;
    await vi.waitFor(() =>
      expect(sockets[1].sent.some((f) => f.method === 'commands.get')).toBe(
        true,
      ),
    );
    const query = sockets[1].sent.find((f) => f.method === 'commands.get');
    sockets[1].frame({
      type: 'res',
      id: query.id,
      ok: true,
      result: { state: 'unknown' },
    });
    await vi.waitFor(() =>
      expect(client.outcomes.get('uncertain')).toEqual({ state: 'unknown' }),
    );
    expect(
      sockets[1].sent.filter((f) => f.method === 'agents.create'),
    ).toHaveLength(0);
  } finally {
    client.close();
  }
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { agentsApi } from './agents/api';
import { providersApi } from './providers/api';
import { tasksApi } from './tasks/api';
import { voiceApi } from './voice/api';
import { initialAgent } from './agents/model';
import { freshProvider } from './providers/model';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../network/gateway', () => ({
  gatewayRequest: rpc,
  adminHeaders: () => ({ Authorization: 'Bearer fixture-token' }),
}));
const http = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubEnv('VITE_SERVER_URL', 'wss://world.example');
  vi.stubGlobal('fetch', http);
  rpc.mockResolvedValue({});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rpc.mockReset();
  http.mockReset();
});
it('routes queries through RPC preserving cancellation and identifiers', async () => {
  const signal = new AbortController().signal;
  await providersApi.listProviders(signal);
  await agentsApi.listAgents(signal);
  await providersApi.listModels('custom/provider', signal);
  expect(rpc.mock.calls).toEqual([
    ['providers.list', {}, signal, undefined],
    ['agents.list', {}, signal, undefined],
    ['providers.models', { providerId: 'custom/provider' }, signal, undefined],
  ]);
  expect(http).not.toHaveBeenCalled();
});
it('preserves provider settings and empty-key preservation across RPC', async () => {
  const value = freshProvider('compatible');
  await providersApi.saveProvider(value);
  await providersApi.saveProvider(value, 'custom');
  await providersApi.deleteProvider('custom');
  expect(rpc.mock.calls.map((c) => c.slice(0, 2))).toEqual([
    ['providers.save', { value }],
    ['providers.save', { providerId: 'custom', value }],
    ['providers.delete', { providerId: 'custom' }],
  ]);
});
it('keeps creation and update distinct and does not invent standby goals', async () => {
  const value = {
    ...initialAgent,
    name: 'Partner',
    goal: '',
    startTask: false,
  };
  await agentsApi.saveAgent(value);
  await agentsApi.saveAgent(value, 'a');
  expect(rpc.mock.calls.map((c) => c.slice(0, 2))).toEqual([
    ['agents.create', { value }],
    ['agents.update', { agentId: 'a', value }],
  ]);
});
it('uses global plan identities and explicit revisions without nested HTTP paths', async () => {
  const identity = { id: 'task', revision: 2, startedAt: 42 };
  await tasksApi.list({ state: 'unassigned', offset: 20 });
  await tasksApi.runs('p', 20);
  await tasksApi.control(
    { id: 'p', revision: 3 } as any,
    'run',
    { requestId: 'stable' },
    identity,
  );
  await tasksApi.reassign({ id: 'p', revision: 3 } as any, 'b');
  expect(rpc.mock.calls[0][1]).toEqual({ state: 'unassigned', offset: 20 });
  expect(rpc.mock.calls[1][1]).toEqual({ planId: 'p', offset: 20 });
  expect(rpc.mock.calls[2][1]).toMatchObject({
    planId: 'p',
    expectedPlanRevision: 3,
    expectedTask: identity,
  });
  expect(rpc.mock.calls[3][1]).toEqual({
    planId: 'p',
    expectedPlanRevision: 3,
    targetAgentId: 'b',
  });
  expect(http).not.toHaveBeenCalled();
});
it.each([
  ['agents.join', () => agentsApi.joinAgent('a')],
  ['agents.stop', () => agentsApi.stopAgent('a')],
  ['agents.voice', () => agentsApi.setVoiceReplies('a', false)],
] as const)('routes %s without HTTP fallback', async (method, action) => {
  await action();
  expect(rpc.mock.calls[0][0]).toBe(method);
  expect(rpc.mock.calls[0][1].agentId).toBe('a');
  expect(http).not.toHaveBeenCalled();
});
it('surfaces RPC rejection without issuing a second write through HTTP', async () => {
  rpc.mockRejectedValueOnce(Error('请先暂停任务'));
  await expect(agentsApi.saveAgent(initialAgent, 'busy')).rejects.toThrow(
    '请先暂停任务',
  );
  expect(http).not.toHaveBeenCalled();
});
it('retains authenticated HTTP voice management and actionable HTTP errors', async () => {
  const signal = new AbortController().signal;
  http.mockResolvedValueOnce(new Response('[]'));
  await voiceApi.listPiperModels(signal);
  expect(http).toHaveBeenCalledWith(
    'https://world.example/agents/voice-services/piper/models',
    expect.objectContaining({
      signal,
      headers: expect.objectContaining({
        Authorization: 'Bearer fixture-token',
      }),
    }),
  );
  http.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: '音色不可用' }), { status: 503 }),
  );
  await expect(voiceApi.listPiperModels(signal)).rejects.toThrow('音色不可用');
});

it('binds controls to the task identity displayed to the user', async () => {
  const identity = { id: 'original-task', revision: 3, startedAt: 42 };
  await tasksApi.controlRun('r', 'resume', {}, identity);
  await tasksApi.control({ id: 'p', revision: 3 } as any, 'run', {}, identity);
  for (const call of rpc.mock.calls)
    expect(call[1].expectedTask).toEqual(identity);
});

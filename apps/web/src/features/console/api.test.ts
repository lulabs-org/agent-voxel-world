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
it('keeps task history pagination and stable request IDs at the API boundary', async () => {
  const signal = new AbortController().signal;
  await tasksApi.listTaskRuns('a', 'p', 20, signal);
  await tasksApi.taskPlanAction('a', 'p', 'run', { requestId: 'stable' });
  await tasksApi.taskRunAction('a', 'r', 'resume', {
    maxTurns: 150,
    tokenBudget: 100000,
  });
  expect(rpc.mock.calls[0]).toEqual([
    'runs.list',
    { agentId: 'a', planId: 'p', offset: 20 },
    signal,
    undefined,
  ]);
  expect(rpc.mock.calls[1]).toEqual([
    'plans.control',
    {
      agentId: 'a',
      planId: 'p',
      operation: 'run',
      value: { requestId: 'stable' },
    },
    undefined,
    'stable',
  ]);
  expect(rpc.mock.calls[2][1]).toMatchObject({
    agentId: 'a',
    runId: 'r',
    operation: 'resume',
    value: { maxTurns: 150 },
  });
});
it.each([
  ['agents.join', () => agentsApi.joinAgent('a')],
  ['agents.stop', () => agentsApi.stopAgent('a')],
  ['tasks.pause', () => tasksApi.pauseAgent('a')],
  ['tasks.cancel', () => tasksApi.cancelTask('a')],
  ['tasks.resume', () => tasksApi.resumeAgent('a')],
  ['tasks.assign', () => tasksApi.assignTask('a', '木屋')],
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
  await tasksApi.pauseAgent('a', identity);
  await tasksApi.taskRunAction('a', 'r', 'resume', undefined, identity);
  await tasksApi.taskPlanAction('a', 'p', 'run', {}, identity);
  for (const call of rpc.mock.calls)
    expect(call[1].expectedTask).toEqual(identity);
});

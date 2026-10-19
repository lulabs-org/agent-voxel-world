import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { agentsApi } from './agents/api';
import { providersApi } from './providers/api';
import { tasksApi } from './tasks/api';
import { voiceApi } from './voice/api';
import { initialAgent } from './agents/model';
import { freshProvider } from './providers/model';

vi.mock('../../network/gateway', () => ({
  gatewayRequest: vi.fn(),
  adminHeaders: () => ({ Authorization: 'Bearer fixture-token' }),
}));

const http = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv('VITE_SERVER_URL', 'https://world.example');
  vi.stubGlobal('fetch', http);
  http.mockImplementation(() => Promise.resolve(new Response('[]')));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  http.mockReset();
});

it('routes provider queries and mutations through HTTP REST endpoints', async () => {
  const signal = new AbortController().signal;
  http.mockImplementation(() => Promise.resolve(new Response(JSON.stringify([]))));

  await providersApi.listProviders(signal);
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/providers',
    expect.objectContaining({
      method: 'GET',
      signal,
      headers: expect.objectContaining({
        Authorization: 'Bearer fixture-token',
      }),
    }),
  );

  await providersApi.listModels('custom/provider', signal);
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/providers/custom%2Fprovider/models',
    expect.objectContaining({ method: 'GET', signal }),
  );

  const value = freshProvider('compatible');
  await providersApi.saveProvider(value);
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/providers',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(value),
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
      }),
    }),
  );

  await providersApi.saveProvider(value, 'custom');
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/providers/custom',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify(value),
    }),
  );

  http.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await providersApi.deleteProvider('custom');
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/providers/custom',
    expect.objectContaining({ method: 'DELETE' }),
  );
});

it('routes agent operations through HTTP REST endpoints', async () => {
  const signal = new AbortController().signal;
  http.mockImplementation(() => Promise.resolve(new Response(JSON.stringify([]))));

  await agentsApi.listAgents(signal);
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents',
    expect.objectContaining({ method: 'GET', signal }),
  );

  const value = {
    ...initialAgent,
    name: 'Partner',
    goal: '',
    startTask: false,
  };
  await agentsApi.saveAgent(value);
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(value),
    }),
  );

  await agentsApi.saveAgent(value, 'a');
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/a',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify(value),
    }),
  );

  await agentsApi.joinAgent('a');
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/a/join',
    expect.objectContaining({ method: 'POST', body: '{}' }),
  );

  await agentsApi.stopAgent('a');
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/a/stop',
    expect.objectContaining({ method: 'POST', body: '{}' }),
  );

  http.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await agentsApi.deleteAgent('a');
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/a',
    expect.objectContaining({ method: 'DELETE' }),
  );

  await agentsApi.setVoiceReplies('a', false);
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/a/voice',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ enabled: false }),
    }),
  );
});

it('routes task plan queries and controls through HTTP REST endpoints', async () => {
  const identity = { id: 'task', revision: 2, startedAt: 42 };
  http.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ items: [], total: 0 }))),
  );

  await tasksApi.list({ state: 'unassigned', offset: 20 });
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/tasks?state=unassigned&offset=20',
    expect.objectContaining({ method: 'GET' }),
  );

  await tasksApi.get('plan-123');
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/tasks/plan-123',
    expect.objectContaining({ method: 'GET' }),
  );

  await tasksApi.runs('p', 20);
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/tasks/p/runs?offset=20',
    expect.objectContaining({ method: 'GET' }),
  );

  await tasksApi.control(
    { id: 'p', agentId: 'agent-1', revision: 3 } as any,
    'run',
    { requestId: 'stable' },
    identity,
  );
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/tasks/p/run',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        requestId: 'stable',
        agentId: 'agent-1',
        expectedPlanRevision: 3,
        expectedTask: identity,
      }),
    }),
  );

  await tasksApi.reassign(
    { id: 'p', agentId: 'agent-1', revision: 3 } as any,
    'agent-2',
  );
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/tasks/p/reassign',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ targetAgentId: 'agent-2' }),
    }),
  );

  http.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await tasksApi.delete('p', 'agent-1');
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/tasks/p',
    expect.objectContaining({ method: 'DELETE' }),
  );

  await tasksApi.controlRun('run-99', 'resume', {}, identity);
  expect(http).toHaveBeenLastCalledWith(
    'https://world.example/agents/task-runs/run-99/resume',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ expectedTask: identity }),
    }),
  );
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

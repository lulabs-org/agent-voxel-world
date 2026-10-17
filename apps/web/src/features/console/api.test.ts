import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { consoleApi } from './api';
import { freshProvider, initialAgent } from './model';

const request = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubEnv('VITE_SERVER_URL', 'wss://world.example');
  vi.stubGlobal('fetch', request);
  request.mockImplementation(async () => new Response('{}'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  request.mockReset();
});

it('propagates cancellation to list and model requests, encoding provider IDs', async () => {
  const signal = new AbortController().signal;
  await consoleApi.listProviders(signal);
  await consoleApi.listAgents(signal);
  await consoleApi.listModels('custom/provider', signal);
  expect(
    request.mock.calls.map(([url, init]) => [
      url,
      init?.method,
      init?.signal,
      init?.body,
    ]),
  ).toEqual([
    ['https://world.example/agents/providers', 'GET', signal, undefined],
    ['https://world.example/agents', 'GET', signal, undefined],
    [
      'https://world.example/agents/providers/custom%2Fprovider/models',
      'GET',
      signal,
      undefined,
    ],
  ]);
});

it('keeps provider create, edit, key preservation and deletion contracts', async () => {
  const draft = freshProvider('compatible');
  await consoleApi.saveProvider(draft);
  await consoleApi.saveProvider(draft, 'provider/id');
  request.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(
    consoleApi.deleteProvider('provider/id'),
  ).resolves.toBeUndefined();
  expect(request.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
    ['https://world.example/agents/providers', 'POST'],
    ['https://world.example/agents/providers/provider%2Fid', 'PUT'],
    ['https://world.example/agents/providers/provider%2Fid', 'DELETE'],
  ]);
  const init = request.mock.calls[1][1]!;
  expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(init.body as string)).toEqual(draft);
  expect(JSON.parse(init.body as string).apiKey).toBe('');
});
it('loads server voice choices with cancellation and preserves server errors', async () => {
  const signal = new AbortController().signal;
  const voices = [{ name: 'Tingting', language: 'zh_CN' }];
  request.mockResolvedValueOnce(new Response(JSON.stringify(voices)));
  await expect(consoleApi.listLocalVoices(signal)).resolves.toEqual(voices);
  expect(request).toHaveBeenCalledWith(
    'https://world.example/voice/tts/voices',
    { signal },
  );
  request.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: '音色不可用' }), { status: 503 }),
  );
  await expect(consoleApi.listLocalVoices(signal)).rejects.toThrow(
    '音色不可用',
  );
});

it('keeps editing separate from creation and preserves explicit agent settings', async () => {
  const settings = {
    ...initialAgent,
    intervalMode: 'random' as const,
    intervalMinMs: 1200,
    intervalMaxMs: 8500,
    voiceReplies: false,
  };
  await consoleApi.saveAgent(settings);
  await consoleApi.saveAgent(settings, 'agent/id');
  expect(
    request.mock.calls.map(([url, init]) => [
      url,
      init?.method,
      JSON.parse(init?.body as string),
    ]),
  ).toEqual([
    ['https://world.example/agents', 'POST', settings],
    ['https://world.example/agents/agent%2Fid', 'PUT', settings],
  ]);
});

it.each([
  ['join', () => consoleApi.joinAgent('a/b'), {}],
  ['resume', () => consoleApi.resumeAgent('a/b'), {}],
  ['pause', () => consoleApi.pauseAgent('a/b'), {}],
  ['cancel', () => consoleApi.cancelTask('a/b'), {}],
  ['stop', () => consoleApi.stopAgent('a/b'), {}],
  [
    'task',
    () => consoleApi.assignTask('a/b', '建造木屋'),
    { goal: '建造木屋' },
  ],
  ['voice', () => consoleApi.setVoiceReplies('a/b', false), { enabled: false }],
] as const)('sends %s as a scoped action', async (path, action, body) => {
  await action();
  expect(request).toHaveBeenCalledWith(
    `https://world.example/agents/a%2Fb/${path}`,
    expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }),
  );
});

it('preserves actionable errors for HTML responses and server rejections', async () => {
  request.mockResolvedValueOnce(
    new Response('<html>not found</html>', { status: 404 }),
  );
  await expect(consoleApi.listAgents()).rejects.toThrow('Agent 接口不可用');
  request.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: '请先暂停任务' }), { status: 409 }),
  );
  await expect(consoleApi.saveAgent(initialAgent, 'busy')).rejects.toThrow(
    '请先暂停任务',
  );
});

it('sends standby creation explicitly without inventing a task', async () => {
  await consoleApi.saveAgent({
    ...initialAgent,
    name: 'Partner',
    goal: '',
    startTask: false,
  });
  expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toMatchObject({
    goal: '',
    startTask: false,
  });
});

it('submits task-specific quotas with assignment and renewal', async () => {
  const limits = { maxTurns: 12, tokenBudget: 15000, taskTimeoutMs: 180000 };
  await consoleApi.assignTask('fixture', '观察营地', limits);
  await consoleApi.resumeAgent('fixture', limits);
  expect(
    request.mock.calls.map(([, init]) => JSON.parse(init!.body as string)),
  ).toEqual([{ goal: '观察营地', ...limits }, limits]);
});

it('keeps task history cancellation, encoded routes and idempotency keys in the API boundary', async () => {
  const signal = new AbortController().signal;
  await consoleApi.listTaskPlans('a/b', signal);
  await consoleApi.listTaskRuns('a/b', 'p/q', 20, signal);
  await consoleApi.taskPlanAction('a/b', 'p/q', 'run', {
    requestId: 'stable-retry',
  });
  await consoleApi.taskRunAction('a/b', 'r/s', 'resume', {
    maxTurns: 150,
    tokenBudget: 100000,
  });
  expect(
    request.mock.calls.map(([url, init]) => [url, init?.method, init?.signal]),
  ).toEqual([
    ['https://world.example/agents/a%2Fb/tasks', 'GET', signal],
    [
      'https://world.example/agents/a%2Fb/tasks/p%2Fq/runs?offset=20',
      'GET',
      signal,
    ],
    ['https://world.example/agents/a%2Fb/tasks/p%2Fq/run', 'POST', undefined],
    [
      'https://world.example/agents/a%2Fb/task-runs/r%2Fs/resume',
      'POST',
      undefined,
    ],
  ]);
  expect(JSON.parse(request.mock.calls[2][1]!.body as string)).toEqual({
    requestId: 'stable-retry',
  });
});

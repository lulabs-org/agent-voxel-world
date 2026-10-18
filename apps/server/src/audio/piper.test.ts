import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import { PiperModels } from './piper-models';
import { PiperTts } from './piper-tts';
import { speechEndpoint } from './speech-endpoint';
import { DEFAULT_PIPER_MODEL, PIPER_MODELS } from '@voxel/shared';
import { installAgentRoutes } from '../routes/agent.routes';
import type { AgentManager } from '../agent/manager';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const json = (data: unknown) => new Response(JSON.stringify(data));
const catalog = (installed = false) =>
  json({ data: installed ? [{ id: DEFAULT_PIPER_MODEL }] : [] });
const wav = () => {
  const b = Buffer.alloc(32044);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(32000, 40);
  for (let i = 44; i < b.length; i += 2) b.writeInt16LE(1000, i);
  return b;
};
it('resolves engine overrides, shared URL, legacy Piper fallback and blank values', () => {
  for (const key of ['WHISPER_API_URL', 'PIPER_API_URL', 'SPEECH_API_URL'])
    vi.stubEnv(key, '  ');
  expect(speechEndpoint('whisper')).toBe('http://127.0.0.1:8000/v1');
  vi.stubEnv('WHISPER_API_URL', 'http://legacy/v1/');
  expect(speechEndpoint('piper')).toBe('http://legacy/v1');
  vi.stubEnv('SPEECH_API_URL', 'http://speech/v1');
  expect(speechEndpoint('piper')).toBe('http://speech/v1');
  expect(speechEndpoint('whisper')).toBe('http://legacy/v1');
  vi.stubEnv('PIPER_API_URL', 'http://piper/v1');
  expect(speechEndpoint('piper')).toBe('http://piper/v1');
});
it('requests the model voice, speed and 16k PCM WAV and validates the returned duration', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(wav()));
  const result = await new PiperTts(
    { speed: 0.8 },
    'http://speech/v1',
    request,
  ).synthesize('你好', new AbortController().signal);
  expect(result.durationMs).toBe(1000);
  expect(JSON.parse(request.mock.calls[0][1]?.body as string)).toEqual({
    model: DEFAULT_PIPER_MODEL,
    voice: 'huayan',
    input: '你好',
    speed: 0.8,
    response_format: 'wav',
    sample_rate: 16000,
  });
  expect(request.mock.calls[0][0]).toBe('http://speech/v1/audio/speech');
});
it.each(PIPER_MODELS)(
  'synthesizes the selected $name without falling back to another voice',
  async (model) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(wav()));
    await new PiperTts(
      { model: model.id },
      'http://speech/v1',
      request,
    ).synthesize('你好', new AbortController().signal);
    expect(JSON.parse(request.mock.calls[0][1]?.body as string)).toMatchObject({
      model: model.id,
      voice: model.voice,
    });
  },
);
it('reports missing models and unreachable services, rejects invalid/oversized audio and honors cancellation', async () => {
  const request = vi.fn<typeof fetch>();
  const tts = new PiperTts({}, 'http://speech/v1', request);
  request.mockResolvedValueOnce(new Response('', { status: 404 }));
  await expect(
    tts.synthesize('你好', new AbortController().signal),
  ).rejects.toThrow('未安装');
  request.mockRejectedValueOnce(Error('offline'));
  await expect(
    tts.synthesize('你好', new AbortController().signal),
  ).rejects.toThrow('无法连接');
  request.mockResolvedValueOnce(new Response('invalid'));
  await expect(
    tts.synthesize('你好', new AbortController().signal),
  ).rejects.toThrow();
  request.mockResolvedValueOnce(
    new Response(Buffer.alloc(3 * 1024 * 1024 + 1)),
  );
  await expect(
    tts.synthesize('你好', new AbortController().signal),
  ).rejects.toThrow('过大');
  const abort = new AbortController();
  abort.abort();
  const count = request.mock.calls.length;
  await expect(tts.synthesize('你好', abort.signal)).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(count);
});
it('deduplicates installs, rejects other models, and verifies cache after download', async () => {
  let installed = false;
  let finish!: () => void;
  const request = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'POST') {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      installed = true;
      return new Response(null);
    }
    return catalog(installed);
  });
  const models = new PiperModels('http://speech/v1', request);
  expect((await models.list())[0].state).toBe('missing');
  models.start(DEFAULT_PIPER_MODEL);
  models.start(DEFAULT_PIPER_MODEL);
  expect(() => models.start(PIPER_MODELS[1].id)).toThrow('另一个');
  expect(() => models.start('other/model')).toThrow('支持');
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect((await models.list())[0].state).toBe('installing');
  finish();
  await vi.waitFor(async () =>
    expect((await models.list())[0].state).toBe('installed'),
  );
  expect(
    request.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(1);
  expect(
    (await new PiperModels('http://speech/v1', request).list())[0].state,
  ).toBe('installed');
});
it('does not treat a successful download response as proof of installation; retries failures', async () => {
  let installed = false;
  const request = vi.fn<typeof fetch>(async (_url, init) =>
    init?.method === 'POST' ? new Response(null) : catalog(installed),
  );
  const models = new PiperModels('http://speech/v1', request);
  models.start(DEFAULT_PIPER_MODEL);
  await vi.waitFor(async () =>
    expect((await models.list())[0].state).toBe('failed'),
  );
  installed = true;
  models.start(DEFAULT_PIPER_MODEL);
  await vi.waitFor(async () =>
    expect((await models.list())[0].state).toBe('installed'),
  );
});
it('bounds installation waiting and makes failure retryable', async () => {
  const request = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method !== 'POST') return catalog();
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener(
        'abort',
        () => reject(init.signal?.reason),
        { once: true },
      );
    });
  });
  const models = new PiperModels('http://speech/v1', request, 20);
  models.start(DEFAULT_PIPER_MODEL);
  await vi.waitFor(async () =>
    expect((await models.list())[0]).toMatchObject({
      state: 'failed',
      error: expect.stringContaining('超时'),
    }),
  );
});
it('keeps Piper management under the configured origin boundary and returns 202 for downloads', async () => {
  vi.stubEnv('WEB_ORIGIN', 'http://world.test');
  const models = new PiperModels(
    'http://speech/v1',
    vi.fn<typeof fetch>(async () => catalog(true)),
  );
  const app = express();
  installAgentRoutes(app, {
    voiceServices: { piperModels: models },
  } as unknown as AgentManager);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/agents/voice-services/piper`;
  try {
    expect(
      (
        await fetch(`${url}/models`, {
          headers: { Origin: 'http://evil.test' },
        })
      ).status,
    ).toBe(403);
    const headers = {
      Origin: 'http://world.test',
      'Content-Type': 'application/json',
    };
    expect((await fetch(`${url}/models`, { headers })).status).toBe(200);
    expect(
      (
        await fetch(`${url}/install`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: DEFAULT_PIPER_MODEL }),
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await fetch(`${url}/install`, {
          method: 'POST',
          headers,
          body: '{"model":"bad"}',
        })
      ).status,
    ).toBe(400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

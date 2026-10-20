import { expect, it, vi } from 'vitest';
import { createTestServer } from './helpers/test-server';
import { LocalSpeech } from '../src/modules/audio/asr/local-speech';
import { PiperModels } from '../src/modules/audio/tts/piper-models';

const token = 'Bearer fixture-gateway-token-for-tests';
const origin = 'http://world.test';
const headers = {
  Authorization: token,
  Origin: origin,
  'Content-Type': 'application/json',
};

it('assembles public audio endpoints separately from protected management routes', async () => {
  const speech = new LocalSpeech();
  vi.spyOn(speech, 'status').mockResolvedValue({
    available: true,
    reason: 'fixture',
  });
  const transcribe = vi
    .spyOn(speech, 'transcribe')
    .mockResolvedValue('fixture text');
  vi.spyOn(PiperModels.prototype, 'status').mockResolvedValue({
    available: false,
    reason: 'fixture',
  });
  const server = await createTestServer({ origin, speech });
  try {
    const capabilities = await fetch(server.httpUrl + '/voice/capabilities', {
      headers: { Origin: origin },
    });
    expect(capabilities.status).toBe(200);
    expect(await capabilities.json()).toMatchObject({
      local: { available: true },
    });
    const response = await fetch(
      server.httpUrl + '/voice/transcribe?language=en',
      {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'audio/wav' },
        body: 'fixture audio',
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: 'fixture text' });
    expect(transcribe.mock.calls[0][0]).toEqual(Buffer.from('fixture audio'));
    expect(transcribe.mock.calls[0][2]).toBe('en');
    const missing = await fetch(server.httpUrl + '/voice/tts/missing', {
      headers,
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: '管理接口不存在，请确认前后端版本一致。',
    });
    const spec = await (await fetch(server.httpUrl + '/api-docs.json')).json();
    for (const [path, method] of [
      ['/voice/capabilities', 'get'],
      ['/voice/transcribe', 'post'],
      ['/voice/asr/services', 'get'],
      ['/voice/tts/services', 'get'],
      ['/voice/tts/piper/models', 'get'],
    ]) {
      expect(spec.paths[path]?.[method], `${method} ${path}`).toBeDefined();
    }
  } finally {
    await server.close();
    vi.restoreAllMocks();
  }
});

it('protects each management domain and retains transport policies after path migration', async () => {
  const server = await createTestServer({ origin });
  try {
    const paths = [
      '/ai-characters',
      '/providers',
      '/tasks',
      '/task-runs/missing/pause',
      '/voice/tts/services',
      '/voice/tts/piper/models',
      '/voice/asr/services',
    ];
    for (const path of paths) {
      const url = server.httpUrl + path;
      expect((await fetch(url)).status, path).toBe(401);
      expect(
        (
          await fetch(url, {
            headers: { ...headers, Origin: 'https://foreign.test' },
          })
        ).status,
        path,
      ).toBe(403);
      const preflight = await fetch(url, {
        method: 'OPTIONS',
        headers: { Origin: origin },
      });
      expect(preflight.status, path).toBe(204);
      expect(preflight.headers.get('access-control-allow-methods')).toContain(
        'PUT',
      );
      expect(preflight.headers.get('access-control-allow-methods')).toContain(
        'DELETE',
      );
      expect(preflight.headers.get('access-control-allow-headers')).toContain(
        'Authorization',
      );
      const badType = await fetch(url, {
        method: 'POST',
        headers: { Authorization: token, Origin: origin },
        body: 'x',
      });
      expect(badType.status, path).toBe(415);
      const badJson = await fetch(url, { method: 'POST', headers, body: '{' });
      expect(badJson.status, path).toBe(400);
      expect((await badJson.json()).error).toContain(
        path.startsWith('/voice/asr') ? 'JSON' : '无法处理请求',
      );
      const large = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: 'x'.repeat(40000) }),
      });
      expect(large.status, path).toBe(413);
      if (!path.startsWith('/voice/asr')) {
        const invalidKey = await fetch(url, {
          headers: { ...headers, 'Idempotency-Key': 'invalid key' },
        });
        expect(invalidKey.status, path).toBe(400);
      }
    }
    for (const path of [
      '/ai-characters',
      '/providers',
      '/voice/tts/services',
      '/voice/asr/services',
    ]) {
      const response = await fetch(server.httpUrl + path, { headers });
      expect(response.status, path).toBe(200);
      expect(Array.isArray(await response.json())).toBe(true);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    const plans = await fetch(
      server.httpUrl + '/tasks?state=unassigned&offset=0',
      { headers },
    );
    expect(plans.status).toBe(200);
    expect(await plans.json()).toMatchObject({ items: [], total: 0 });
    const asrLarge = await fetch(server.httpUrl + '/voice/asr/services', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'x'.repeat(9000) }),
    });
    expect(asrLarge.status).toBe(413);
    const voiceLarge = await fetch(server.httpUrl + '/voice/tts/services', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'x'.repeat(9000) }),
    });
    expect(voiceLarge.status).toBe(400); // Parsed under 32 KiB, rejected by service validation.
  } finally {
    await server.close();
  }
});

it('routes resource IDs and request bodies to their owning domain without old Agent aliases', async () => {
  const server = await createTestServer({ origin });
  try {
    const createProvider = await fetch(server.httpUrl + '/providers', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'ollama',
        name: 'Local',
        baseUrl: 'http://127.0.0.1:11434/v1',
      }),
    });
    expect(createProvider.status).toBe(201);
    const provider = await createProvider.json();
    const models = vi
      .spyOn(server.characters, 'models')
      .mockResolvedValue(['fixture-model']);
    expect(
      await (
        await fetch(`${server.httpUrl}/providers/${provider.id}/models`, {
          headers,
        })
      ).json(),
    ).toEqual({ models: ['fixture-model'] });
    expect(models).toHaveBeenCalledWith(provider.id);
    expect(
      (
        await fetch(`${server.httpUrl}/providers/${provider.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            type: 'ollama',
            name: 'Updated',
            baseUrl: 'http://127.0.0.1:11434/v1',
          }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${server.httpUrl}/providers/${provider.id}`, {
          method: 'DELETE',
          headers,
        })
      ).status,
    ).toBe(204);
    expect('assignTask' in server.characters).toBe(false);
    expect('controlTask' in server.characters).toBe(false);
    expect('resume' in server.characters).toBe(false);
    for (const operation of ['task', 'pause', 'resume', 'cancel']) {
      const removed = await fetch(
        `${server.httpUrl}/ai-characters/agent-123/${operation}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ goal: 'test' }),
        },
      );
      expect(removed.status).toBe(404);
    }
    const createPlan = vi
      .spyOn(server.characters.tasks, 'createTaskPlan')
      .mockResolvedValue({ id: 'plan-123' } as any);
    const draft = {
      characterId: 'agent-123',
      name: 'Plan',
      goal: 'test',
      timing: { kind: 'immediate' },
      timeZone: 'UTC',
    };
    expect(
      (
        await fetch(server.httpUrl + '/tasks', {
          method: 'POST',
          headers,
          body: JSON.stringify(draft),
        })
      ).status,
    ).toBe(201);
    expect(createPlan).toHaveBeenCalledWith('agent-123', draft);
    const run = vi
      .spyOn(server.characters.tasks, 'controlTaskRun')
      .mockResolvedValue({ id: 'run-123' } as any);
    for (const operation of ['pause', 'resume', 'cancel']) {
      expect(
        (
          await fetch(`${server.httpUrl}/task-runs/run-123/${operation}`, {
            method: 'POST',
            headers,
            body: '{}',
          })
        ).status,
      ).toBe(200);
      expect(run).toHaveBeenCalledWith(undefined, 'run-123', operation, {});
    }
    const reassign = vi
      .spyOn(server.characters.tasks, 'reassignPlan')
      .mockResolvedValue({ id: 'plan-123' } as any);
    expect(
      (
        await fetch(server.httpUrl + '/tasks/plan-123/reassign', {
          method: 'POST',
          headers,
          body: JSON.stringify({ targetCharacterId: 'agent-456' }),
        })
      ).status,
    ).toBe(200);
    expect(reassign).toHaveBeenCalledWith('plan-123', 'agent-456');
    const voice = await fetch(server.httpUrl + '/voice/tts/services', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'browser',
        name: 'Browser',
        voice: 'Test',
        speed: 1,
      }),
    });
    expect(voice.status).toBe(201);
    const service = await voice.json();
    expect(
      (
        await fetch(`${server.httpUrl}/voice/tts/services/${service.id}`, {
          method: 'DELETE',
          headers,
        })
      ).status,
    ).toBe(204);
    for (const path of [
      '/agents',
      '/agents/missing',
      '/ai-characters/providers',
      '/ai-characters/tasks',
      '/ai-characters/task-runs/missing/pause',
      '/ai-characters/voice-services',
      '/ai-characters/voice-services/piper/models',
    ]) {
      expect(
        (await fetch(server.httpUrl + path, { headers })).status,
        path,
      ).toBe(404);
    }
  } finally {
    vi.restoreAllMocks();
    await server.close();
  }
});

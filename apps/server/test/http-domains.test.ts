import { expect, it, vi } from 'vitest';
import { createTestServer } from './helpers/test-server';

const token = 'Bearer fixture-gateway-token-for-tests';
const origin = 'http://world.test';
const headers = {
  Authorization: token,
  Origin: origin,
  'Content-Type': 'application/json',
};

it('protects each management domain and retains transport policies after path migration', async () => {
  const server = await createTestServer({ origin });
  try {
    const paths = [
      '/agents',
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
      '/agents',
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
      .spyOn(server.agents, 'models')
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
    const immediate = vi
      .spyOn(server.agents, 'assignTask')
      .mockResolvedValue({ id: 'agent-123' } as Awaited<
        ReturnType<typeof server.agents.assignTask>
      >);
    const assigned = await fetch(server.httpUrl + '/agents/agent-123/task', {
      method: 'POST',
      headers,
      body: JSON.stringify({ goal: 'test' }),
    });
    expect(assigned.status).toBe(200);
    expect(immediate).toHaveBeenCalledWith('agent-123', { goal: 'test' });
    const createPlan = vi
      .spyOn(server.agents, 'createTaskPlan')
      .mockResolvedValue({ id: 'plan-123' } as any);
    const draft = { agentId: 'agent-123', name: 'Plan', goal: 'test' };
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
      .spyOn(server.agents, 'controlTaskRun')
      .mockResolvedValue({ id: 'run-123' } as any);
    expect(
      (
        await fetch(server.httpUrl + '/task-runs/run-123/pause', {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
    ).toBe(200);
    expect(run).toHaveBeenCalledWith(undefined, 'run-123', 'pause', {});
    const reassign = vi
      .spyOn(server.agents, 'reassignPlan')
      .mockResolvedValue({ id: 'plan-123' } as any);
    expect(
      (
        await fetch(server.httpUrl + '/tasks/plan-123/reassign', {
          method: 'POST',
          headers,
          body: JSON.stringify({ targetAgentId: 'agent-456' }),
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
      '/agents/providers',
      '/agents/tasks',
      '/agents/task-runs/missing/pause',
      '/agents/voice-services',
      '/agents/voice-services/piper/models',
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

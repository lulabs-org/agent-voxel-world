import { describe, expect, it, vi } from 'vitest';
import type { WorldEvent } from '@voxel/shared';
import type { AgentConfig } from '../contracts/config';
import { emptyState } from '../contracts/state';
import { newTask } from '../agent/task/state';
import { createAgentRuntime } from './runtime';
import { MemorySession } from '../testing/memory-session';

const chat = (seq: number, actor = 'alice'): WorldEvent => ({
  seq,
  at: 1_700_000_000_000 + seq,
  type: 'chat',
  actor,
  actorKind: 'human',
  data: {
    scope: 'private',
    kind: 'text',
    text: 'hello',
    name: 'Alice',
    recipients: ['ai'],
  },
});

describe('AgentRuntime facade', () => {
  it('records, persists and queues an addressed chat exactly once', async () => {
    const store = { save: vi.fn(async () => {}) };
    const runtime = createAgentRuntime({
      session: new MemorySession(),
      selfId: 'ai',
      store,
    });

    await expect(runtime.submit(chat(1))).resolves.toBe(true);
    expect(runtime.attention.pending).toBe(true);
    expect(runtime.state.inbox?.events).toHaveLength(1);
    expect(runtime.state.inbox?.events[0]).toMatchObject({
      id: `chat:${runtime.attention.generation}:alice:1`,
      kind: 'chat',
      state: 'pending',
      audience: 'alice',
    });
    expect(store.save).toHaveBeenCalledTimes(1);

    await expect(runtime.submit(chat(1))).resolves.toBe(false);
    expect(runtime.state.inbox?.events).toHaveLength(1);
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it('ignores chat that is not addressed to this character', async () => {
    const runtime = createAgentRuntime({
      session: new MemorySession(),
      selfId: 'ai',
    });
    const other = {
      ...chat(1),
      data: {
        scope: 'private',
        kind: 'text',
        text: 'hello',
        name: 'Bob',
        recipients: ['someone-else'],
      },
    };
    await expect(runtime.submit(other)).resolves.toBe(false);
    expect(runtime.state.inbox).toBeUndefined();
  });

  it('applies authorized operator control and exposes a copy-only snapshot', async () => {
    const state = {
      ...emptyState(),
      task: { current: newTask('walk') },
    };
    const runtime = createAgentRuntime({
      session: new MemorySession(),
      selfId: 'ai',
      state,
    });

    await runtime.control(
      { type: 'pause' },
      { kind: 'operator' },
      {} as AgentConfig,
    );
    expect(runtime.state.task.current?.status).toBe('paused');

    const snapshot = runtime.snapshot();
    expect(snapshot).not.toBe(runtime.state);
    snapshot.task.current!.status = 'completed';
    expect(runtime.state.task.current?.status).toBe('paused');
  });
});

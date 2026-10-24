import { describe, expect, it } from 'vitest';
import { emptyState, snapshotState } from '../contracts/state';
import legacy from './fixtures/v2-runtime.json';
import { restoreState } from './migrate';

describe('state persistence', () => {
  it('moves a flat v2 runtime into the partitioned v3 shape', () => {
    const state = restoreState(legacy);
    expect(state.version).toBe(3);
    expect(state.task.current).toMatchObject({
      goal: 'old build',
      calls: 3,
      startedAt: 1700000000000,
    });
    expect(state.task.identity).toEqual({
      id: 'legacy-lease',
      revision: 2,
      startedAt: 1700000000000,
    });
    expect(state.task.usage).toEqual({
      calls: 3,
      tokens: 600,
      estimated: false,
    });
    expect(state.conversation.exchanges).toEqual(legacy.exchanges);
    expect(state.conversation.lastChatAt).toBe(1700000000500);
    expect(state.checkpoint.pi?.inFlight?.state).toBe('executing');
    expect(state.checkpoint.unknownEffect).toEqual(legacy.unknownEffect);
    expect(state.effects.previous).toEqual(legacy.previous);
    expect(state.effects.pendingEffects).toEqual(legacy.pendingEffects);
    expect(state.health).toEqual({
      waitSignature: '[]',
      failures: 2,
      noProgress: 1,
      lastResponse: '旧回答',
    });
    expect(state.inbox?.events).toEqual([]);
  });

  it('is stable across a second restore and unknown archives', () => {
    const once = restoreState(legacy);
    expect(restoreState(JSON.parse(JSON.stringify(once)))).toEqual(once);
    expect(restoreState(undefined)).toEqual(emptyState());
    expect(restoreState('broken')).toEqual(emptyState());
  });

  it('keeps archived run snapshots free of character usage', () => {
    const state = restoreState(legacy);
    const snapshot = snapshotState(state);
    expect(snapshot.task.current?.goal).toBe('old build');
    expect(snapshot.task.usage).toBeUndefined();
    expect(state.task.usage).toBeDefined();
  });
});

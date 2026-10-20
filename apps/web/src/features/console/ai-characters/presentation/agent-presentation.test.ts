import type { AICharacterView } from '@voxel/shared';
import { expect, it } from 'vitest';
import { initialAICharacter } from '../model';
import { aiCharacterPresentation } from './agent-presentation';
const job = (extra: Partial<AICharacterView> = {}): AICharacterView => ({
  ...initialAICharacter,
  id: 'agent',
  name: 'Test',
  providerName: 'Local',
  status: 'idle',
  createdAt: 0,
  logs: [],
  task: {
    goal: 'Explore',
    status: 'running',
    summary: '',
    reason: '',
    calls: 2,
    tokens: 30,
    estimated: false,
    startedAt: 0,
    elapsedMs: 100,
  },
  ...extra,
});
it('separates a scheduled task from the idle process between model calls', () => {
  expect(aiCharacterPresentation(job({ sessionId: 'player' }))).toMatchObject({
    online: true,
    executing: true,
    canEdit: false,
  });
});
it('makes offline, failed-but-online and transitioning characters distinct', () => {
  expect(aiCharacterPresentation(job({ status: 'stopped' }))).toMatchObject({
    online: false,
    presence: '未在世界中',
  });
  expect(
    aiCharacterPresentation(
      job({ status: 'failed', sessionId: 'player', task: undefined }),
    ),
  ).toMatchObject({ online: true, presence: '在世界中', attention: true });
  for (const status of ['joining', 'stopping'] as const) {
    expect(aiCharacterPresentation(job({ status }))).toMatchObject({
      transitioning: true,
      occupiesSlot: true,
      canEdit: false,
    });
  }
});
it('preserves edit availability and status for paused and terminal tasks', () => {
  for (const status of [
    'paused',
    'completed',
    'cancelled',
    'budget',
    'needs_input',
    'blocked',
  ] as const) {
    const original = job();
    const state = aiCharacterPresentation({
      ...original,
      sessionId: 'player',
      task: { ...original.task!, status },
    });
    expect(state.canEdit).toBe(true);
    expect(state.ended).toBe(['completed', 'cancelled'].includes(status));
  }
});
it('keeps a new standby character free of phantom task actions', () => {
  expect(
    aiCharacterPresentation(job({ sessionId: 'player', task: undefined })),
  ).toMatchObject({
    online: true,
    executing: false,
    canEdit: true,
    taskLabel: '等待安排任务',
  });
});

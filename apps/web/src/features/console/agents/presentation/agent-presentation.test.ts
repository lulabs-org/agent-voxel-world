import type { ManagedAgentView } from '@voxel/shared';
import { expect, it } from 'vitest';
import { initialAgent } from '../model';
import { agentPresentation } from './agent-presentation';
const job = (extra: Partial<ManagedAgentView> = {}): ManagedAgentView => ({
  ...initialAgent,
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
  expect(agentPresentation(job({ sessionId: 'player' }))).toMatchObject({
    online: true,
    executing: true,
    canPause: true,
    canResume: false,
    canEdit: false,
  });
});
it('makes offline, failed-but-online and transitioning characters distinct', () => {
  expect(agentPresentation(job({ status: 'stopped' }))).toMatchObject({
    online: false,
    presence: '未在世界中',
    canPause: false,
  });
  expect(
    agentPresentation(
      job({ status: 'failed', sessionId: 'player', task: undefined }),
    ),
  ).toMatchObject({ online: true, presence: '在世界中', attention: true });
  for (const status of ['joining', 'stopping'] as const) {
    expect(agentPresentation(job({ status }))).toMatchObject({
      transitioning: true,
      occupiesSlot: true,
      canEdit: false,
      canResume: false,
      canCancel: false,
    });
  }
});
it('offers the right next action for every paused or terminal task state', () => {
  for (const status of [
    'paused',
    'completed',
    'cancelled',
    'budget',
    'needs_input',
    'blocked',
  ] as const) {
    const original = job();
    const state = agentPresentation({
      ...original,
      sessionId: 'player',
      task: { ...original.task!, status },
    });
    expect(state.canResume).toBe(true);
    expect(state.canPause).toBe(false);
    expect(state.canEdit).toBe(true);
    expect(state.ended).toBe(['completed', 'cancelled'].includes(status));
    expect(state.resumeLabel).toBe(
      status === 'budget'
        ? '调整额度并继续'
        : state.ended
          ? '重新执行任务'
          : '继续任务',
    );
  }
});
it('never offers to resume a task whose private recipient expired', () => {
  expect(
    agentPresentation(
      job({ status: 'stopped', taskRequiresReassignment: true }),
    ).canResume,
  ).toBe(false);
});
it('keeps a new standby character free of phantom task actions', () => {
  expect(
    agentPresentation(job({ sessionId: 'player', task: undefined })),
  ).toMatchObject({
    online: true,
    executing: false,
    canEdit: true,
    canResume: false,
    canCancel: false,
    taskLabel: '等待安排任务',
  });
});

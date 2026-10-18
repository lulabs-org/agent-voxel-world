import type { AgentTask, ManagedAgentView } from '@voxel/shared';
import { expect, it } from 'vitest';
import { initialAgent } from '../../agents/model';
import { taskDuration, taskPresentation } from './task-presentation';
const job = (task: Partial<AgentTask> = {}): ManagedAgentView => ({
  ...initialAgent,
  id: 'fixture',
  name: 'Test',
  providerName: 'Test',
  status: 'idle',
  sessionId: 'fixture-session',
  createdAt: 0,
  logs: [],
  task: {
    goal: '探索营地',
    status: 'budget',
    summary: '准备向北探索',
    reason: 'token 预算耗尽',
    calls: 5,
    tokens: 60250,
    estimated: false,
    elapsedMs: 9000,
    startedAt: 0,
    ...task,
  },
});
it('identifies token exhaustion even when calls and execution time have ample allowance', () => {
  const view = taskPresentation(job())!;
  expect(view.status).toBe('已暂停 · token 预算耗尽');
  expect(view.resources.filter((r) => r.exhausted).map((r) => r.id)).toEqual([
    'tokens',
  ]);
  expect(view.resources.find((r) => r.id === 'tokens')?.used).toBe(60250);
  expect(view.reason).toBe('token 预算耗尽');
  expect(view.reason).not.toContain('准备向北探索');
});
it('handles each resource limit independently, including equality and simultaneous exhaustion', () => {
  for (const [values, ids] of [
    [{ calls: 100, tokens: 0 }, ['calls']],
    [{ tokens: 0, elapsedMs: 900000 }, ['time']],
    [
      { calls: 100, tokens: 50000, elapsedMs: 900000 },
      ['calls', 'tokens', 'time'],
    ],
  ] as const) {
    expect(
      taskPresentation(job(values))!
        .resources.filter((r) => r.exhausted)
        .map((r) => r.id),
    ).toEqual(ids);
  }
});
it('preserves estimates and does not equate a reached resource cap with task failure or completion', () => {
  const view = taskPresentation(job({ status: 'completed', estimated: true }))!;
  expect(view.status).toBe('已完成');
  expect(view.resources.find((r) => r.id === 'tokens')?.estimated).toBe(true);
  expect(view.attention).toBe(false);
  expect(taskPresentation(job({ status: 'cancelled' }))!.status).toBe('已结束');
  expect(taskPresentation({ ...job(), task: undefined })).toBeUndefined();
});
it('shows actual process interruptions instead of claiming an offline task is executing', () => {
  expect(
    taskPresentation({ ...job({ status: 'running' }), status: 'failed' })!
      .status,
  ).toBe('执行中断');
  expect(
    taskPresentation({ ...job({ status: 'running' }), sessionId: undefined })!
      .status,
  ).toContain('任务未执行');
  expect(taskPresentation({ ...job(), status: 'joining' })!.status).toBe(
    '正在加入世界',
  );
});
it('formats effective execution duration without confusing milliseconds with seconds', () => {
  expect(taskDuration(9000)).toBe('9 秒');
  expect(taskDuration(900000)).toBe('15 分');
  expect(taskDuration(61000)).toBe('1 分 1 秒');
});

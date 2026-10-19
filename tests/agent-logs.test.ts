import { expect, it } from 'vitest';
import { appendAgentLog, restoreAgentLogs } from '../apps/server/src/modules/agent';

it('retains the newest 500 messages with their original timestamps', () => {
  const view = restoreAgentLogs([], []);
  for (let i = 0; i < 520; i++) appendAgentLog(view, `entry-${i}`, 1000 + i);
  expect(view.logs).toHaveLength(500);
  expect(view.logs[0]).toBe('entry-20');
  expect(view.logTimes[0]).toBe(1020);
  expect(view.logs.at(-1)).toBe('entry-519');
  expect(view.logTimes.at(-1)).toBe(1519);
  const archived = JSON.parse(JSON.stringify(view));
  expect(restoreAgentLogs(archived.logs, archived.logTimes)).toEqual(view);
});

it('keeps legacy logs without inventing times, and timestamps only new entries', () => {
  const view = restoreAgentLogs(['old-1', 'old-2'], undefined);
  appendAgentLog(view, 'new', 1234);
  expect(view).toEqual({
    logs: ['old-1', 'old-2', 'new'],
    logTimes: [null, null, 1234],
  });
});

it('preserves alignment while discarding invalid messages and timestamps', () => {
  expect(
    restoreAgentLogs(['a', 42, 'b', 'c', 'd'], [100, 200, NaN, -1, 9e15]),
  ).toEqual({
    logs: ['a', 'b', 'c', 'd'],
    logTimes: [100, null, null, null],
  });
});

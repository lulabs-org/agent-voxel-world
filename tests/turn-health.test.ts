import { expect, it, vi } from 'vitest';
import { TurnHealthMonitor } from '../packages/agent-runtime/src/agent/turn/health';
import { initialToolState } from '../packages/agent-runtime/src/agent/turn/window';
import type { TaskService } from '../packages/agent-runtime/src/agent/task/service';
import type { AgentRunState } from '../packages/agent-runtime/src/agent/task/state';
import type { Observation } from '../packages/agent-runtime/src/contracts';

function fixture(maxStalledTurns?: number) {
  const monitor = new TurnHealthMonitor();
  const finish = vi.fn();
  const options = {
    maxStalledTurns,
    state: initialToolState(),
    attached: true,
    current: () => true,
    memory: { task: { status: 'running' } } as AgentRunState,
    service: { finish, lease: () => ({}) } as unknown as TaskService,
    hasMessage: false,
    launched: false,
    observation: {
      self: { id: 'agent' },
      blocks: [],
      players: [],
      events: [],
    } as unknown as Observation,
  };
  return { options, finish, turn: () => monitor.recordTurn(options) };
}

it('uses the configured consecutive tool failure threshold', () => {
  const f = fixture(5);
  f.options.state.hadError = true;
  f.options.hasMessage = true;
  for (let i = 0; i < 4; i++) f.turn();
  expect(f.finish).not.toHaveBeenCalled();
  f.turn();
  expect(f.finish).toHaveBeenCalledWith(
    {},
    { status: 'blocked', reason: '连续 5 轮工具失败，已停止本次事件。' },
  );
});

it('uses the configured lack-of-progress threshold', () => {
  const f = fixture(2);
  f.turn();
  f.turn();
  expect(f.finish).not.toHaveBeenCalled();
  f.turn();
  expect(f.finish).toHaveBeenCalledWith(
    {},
    {
      status: 'blocked',
      reason: '连续 2 轮失败或没有实际进展，已停止自动重试。',
    },
  );
});

it('keeps the old default and allows disabled runtime limits', () => {
  const f = fixture();
  f.options.state.hadError = true;
  f.options.hasMessage = true;
  f.turn();
  f.turn();
  expect(f.finish).not.toHaveBeenCalled();
  f.turn();
  expect(f.finish).toHaveBeenCalledOnce();
  const unlimited = fixture(Infinity);
  unlimited.options.state.hadError = true;
  for (let i = 0; i < 10; i++) unlimited.turn();
  expect(unlimited.finish).not.toHaveBeenCalled();
});

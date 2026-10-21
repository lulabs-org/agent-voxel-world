import { expect, it, vi } from 'vitest';
import { newTask, TaskService } from '@voxel/agent-runtime';
import type { WorldEvent } from '@voxel/shared';
import { TaskCoordinator } from '../apps/server/src/modules/tasks/coordinator';
import { captureTask } from '../apps/server/src/modules/tasks/execution';
import type {
  TaskExecutionState,
  TaskHostPort,
} from '../apps/server/src/modules/tasks/execution-port';

function fixture() {
  let state: TaskExecutionState;
  let afterInterrupt = async () => {};
  const save = vi.fn(async () => {});
  const stopped = vi.fn();
  const host: TaskHostPort = {
    execution: () => state,
    findExecution: () => state,
    executions: () => [state],
    save,
    schedule: vi.fn(),
    launch: vi.fn(),
    async withStoppedExecution(id, change) {
      stopped(id);
      await afterInterrupt();
      return change();
    },
    validateExecution: (_id, overrides) => ({ ...state.view, ...overrides }),
    storageFailed: () => false,
    committedName: () => state.view.name,
    publicIdentity: () => state.memory.identity,
    resourceVersion: () => 1,
    isClosing: () => false,
    assertWritable: () => {},
  };
  const tasks = new TaskCoordinator(host);
  state = {
    view: {
      id: 'actor',
      name: 'Fixture',
      goal: '',
      providerId: 'fixture',
      model: 'fixture',
      status: 'idle',
      logs: [],
      continuous: false,
      maxTurns: 20,
      tokenBudget: 50000,
      taskTimeoutMs: 900000,
      intervalMode: 'fixed',
      intervalMs: 60000,
      intervalMinMs: 4000,
      intervalMaxMs: 8000,
      timeoutMs: 30000,
      maxTokens: 1024,
      thinking: 'disabled',
      reasoningEffort: 'none',
    },
    memory: {
      task: { ...newTask('Private work', 'alice', 'alice'), status: 'waiting' },
    },
    ledger: tasks.plans,
    online: true,
    currentRunId: undefined,
  };
  const lease = new TaskService(state.memory).lease();
  const message: WorldEvent = {
    seq: 1,
    type: 'chat',
    actor: 'alice',
    actorKind: 'human',
    at: 100,
    data: {
      text: '暂停',
      name: 'Alice',
      kind: 'text',
      scope: 'private',
      recipients: ['actor'],
    },
  };
  return {
    state,
    tasks,
    save,
    stopped,
    host,
    lease,
    message,
    setAfterInterrupt: (fn: () => Promise<void>) => {
      afterInterrupt = fn;
    },
  };
}

it('executes task policy through the narrow host port without an Agent registry or world session', async () => {
  const { state, tasks, host } = fixture();
  state.memory = {};
  const plan = await tasks.createTaskPlan('actor', {
    name: 'Explicit work',
    goal: 'Observe',
    timing: { kind: 'immediate' },
    timeZone: 'UTC',
  });
  expect(tasks.plans.plans).toHaveLength(1);
  expect(tasks.plans.runs).toHaveLength(1);
  expect(state.memory.task?.goal).toBe('Observe');
  expect(host.launch).toHaveBeenCalledWith('actor');
  expect(tasks.plans.runs[0].planId).toBe(plan.id);
});

it('deduplicates the same world command while pending and after its task revision changes', async () => {
  const { state, tasks, save, stopped, lease, message } = fixture();
  const first = tasks.controlMessage(
    'actor',
    'pause',
    lease,
    'world-1',
    message,
  );
  const second = tasks.controlMessage(
    'actor',
    'pause',
    lease,
    'world-1',
    message,
  );
  expect(second).toBe(first);
  const result = await first;
  expect(state.memory.task?.status).toBe('paused');
  expect(state.memory.identity?.revision).toBe(lease.revision + 1);
  expect(
    await tasks.controlMessage('actor', 'pause', lease, 'world-1', message),
  ).toEqual(result);
  expect(stopped).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledTimes(1);
  expect(tasks.plans.runs).toHaveLength(1);
  expect(tasks.plans.runs[0].source).toBe('chat');
  expect(tasks.plans.runs[0].planId).toBeUndefined();
});

it('rejects stale task leases before interrupting a runner or recording a chat run', async () => {
  const { state, tasks, stopped, save, lease, message } = fixture();
  const before = structuredClone(state.memory);
  await expect(
    tasks.controlMessage(
      'actor',
      'cancel',
      { ...lease, revision: lease.revision + 1 },
      'stale',
      message,
    ),
  ).rejects.toThrow('任务已修改');
  expect(stopped).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(state.memory).toEqual(before);
  expect(tasks.plans.runs).toHaveLength(0);
});

it.each([
  { actor: 'bob' },
  {
    data: {
      text: '取消',
      name: 'Alice',
      kind: 'text',
      scope: 'public',
      recipients: ['actor'],
    },
  },
])(
  'retains private task ownership when a world command changes authority: %j',
  async (changes) => {
    const { state, tasks, stopped, lease, message } = fixture();
    await expect(
      tasks.controlMessage('actor', 'cancel', lease, 'unauthorized', {
        ...message,
        ...changes,
      }),
    ).rejects.toThrow('仅任务发起者');
    expect(state.memory.task?.status).toBe('waiting');
    expect(stopped).not.toHaveBeenCalled();
    expect(tasks.plans.runs).toHaveLength(0);
  },
);

it('rechecks identity after waiting for a runner so an old command cannot mutate a newer execution', async () => {
  const { state, tasks, stopped, save, lease, message, setAfterInterrupt } =
    fixture();
  let release!: () => void;
  setAfterInterrupt(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const pending = tasks.controlMessage(
    'actor',
    'cancel',
    lease,
    'racing',
    message,
  );
  await vi.waitFor(() => expect(stopped).toHaveBeenCalled());
  state.memory = { task: newTask('New execution', 'alice', 'alice') };
  captureTask(state);
  const newer = structuredClone(state.memory);
  release();
  await expect(pending).rejects.toThrow('任务已修改');
  expect(state.memory).toEqual(newer);
  expect(state.memory.task?.status).toBe('running');
  expect(save).not.toHaveBeenCalled();
});

it('preserves a completion that settles while a valid cancellation waits for the runner', async () => {
  const { state, tasks, lease, message, setAfterInterrupt } = fixture();
  setAfterInterrupt(async () => {
    state.memory.task!.status = 'completed';
    state.memory.task!.summary = 'Verified completion';
  });
  await tasks.controlMessage('actor', 'cancel', lease, 'finished', message);
  expect(state.memory.task?.status).toBe('completed');
  expect(tasks.plans.runs[0].status).toBe('completed');
});

it('rejects a reused world command ID with different content instead of applying another transition', async () => {
  const { state, tasks, lease, message, stopped } = fixture();
  await tasks.controlMessage('actor', 'pause', lease, 'same', message);
  expect(() =>
    tasks.controlMessage('actor', 'cancel', lease, 'same', message),
  ).toThrow('同一命令标识');
  expect(state.memory.task?.status).toBe('paused');
  expect(stopped).toHaveBeenCalledTimes(1);
});

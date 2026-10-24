// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_TASK_LIMITS } from '@voxel/shared';
import type { PublicAICharacterView } from '@voxel/shared/management';
import { initialAICharacter } from '../model';
import { useCurrentTaskBudget } from './useCurrentTaskBudget';
import { controlTaskRun } from '../../execution/api';
vi.mock('../../execution/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../execution/api')>()),
  controlTaskRun: vi.fn(),
}));
let root: Root, current: ReturnType<typeof useCurrentTaskBudget>;
const updated = vi.fn(async () => {});
const character = (): PublicAICharacterView => ({
  ...initialAICharacter,
  id: 'a',
  providerName: 'provider',
  status: 'idle',
  createdAt: 1,
  sessionId: 'session',
  resourceVersion: 1,
  taskIdentity: { id: 'task', revision: 1, startedAt: 1 },
  taskExecution: { runId: 'run', limits: { ...DEFAULT_TASK_LIMITS } },
  task: {
    goal: 'goal',
    status: 'budget',
    summary: '',
    reason: '',
    calls: 5,
    tokens: 100,
    estimated: false,
    startedAt: 1,
    elapsedMs: 1000,
  },
});
function Harness({ job }: { job: PublicAICharacterView }) {
  current = useCurrentTaskBudget(job, updated);
  return null;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  root = createRoot(document.createElement('div'));
  vi.mocked(controlTaskRun).mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it('retains the task identity captured when opening the resume form', async () => {
  const job = character();
  await act(async () => root.render(<Harness job={job} />));
  await act(async () => current.beginResume());
  await act(async () =>
    root.render(
      <Harness
        job={{ ...job, taskIdentity: { ...job.taskIdentity!, revision: 2 } }}
      />,
    ),
  );
  await act(async () => current.resume());
  expect(controlTaskRun).toHaveBeenCalledWith(
    'run',
    'resume',
    DEFAULT_TASK_LIMITS,
    job.taskIdentity,
  );
  expect(updated).toHaveBeenCalledOnce();
  expect(current.draft).toBeUndefined();
});
it('rejects limits at or below usage and retains the draft after a failed resume', async () => {
  await act(async () => root.render(<Harness job={character()} />));
  await act(async () => current.beginResume());
  await act(async () => current.updateLimits({ maxTurns: 5 }));
  await act(async () => current.resume());
  expect(controlTaskRun).not.toHaveBeenCalled();
  expect(current.error).toBeTruthy();
  await act(async () => current.updateLimits({ maxTurns: 10 }));
  vi.mocked(controlTaskRun).mockRejectedValueOnce(new Error('stale execution'));
  await act(async () => current.resume());
  expect(current.error).toBe('stale execution');
  expect(current.draft?.limits.maxTurns).toBe(10);
  expect(current.busy).toBe(false);
  expect(updated).not.toHaveBeenCalled();
});
it('pause uses the current identity and refreshes after success', async () => {
  const job = character();
  await act(async () => root.render(<Harness job={job} />));
  await act(async () => current.control('pause'));
  expect(controlTaskRun).toHaveBeenCalledWith(
    'run',
    'pause',
    {},
    job.taskIdentity,
  );
  expect(updated).toHaveBeenCalledOnce();
  expect(current.busy).toBe(false);
});

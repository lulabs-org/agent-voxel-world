import type { AICharacterView } from '@voxel/shared';
import type {
  PublicAICharacterView,
  TaskIdentity,
} from '@voxel/shared/management';
import { consoleFetch } from '../request';
export const displayedTaskIdentity = (
  view?: AICharacterView,
): TaskIdentity | null =>
  (view as PublicAICharacterView | undefined)?.taskIdentity ?? null;

export const controlTaskRun = (
  runId: string,
  operation: string,
  value: Record<string, unknown> = {},
  expectedTask: TaskIdentity | null = null,
) =>
  consoleFetch(
    `/task-runs/${encodeURIComponent(runId)}/${encodeURIComponent(operation)}`,
    {
      method: 'POST',
      body: { ...value, expectedTask },
    },
  );

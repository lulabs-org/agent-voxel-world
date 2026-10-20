import type {
  AICharacterView,
  TaskPlan,
  TaskPlanDraft,
  TaskRunPage,
} from '@voxel/shared';
import type {
  PublicAICharacterView,
  PublicPlanView,
  RpcParams,
  TaskIdentity,
} from '@voxel/gateway-protocol';
import { consoleFetch } from '../request';

export const displayedTaskIdentity = (
  view?: AICharacterView,
): TaskIdentity | null =>
  (view as PublicAICharacterView | undefined)?.taskIdentity ?? null;

export type PlanPage = {
  items: PublicPlanView[];
  total: number;
  nextOffset?: number;
};

export const tasksApi = {
  list: (filters: RpcParams = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (filters.state) params.set('state', String(filters.state));
    if (filters.search) params.set('search', String(filters.search));
    if (filters.offset !== undefined)
      params.set('offset', String(filters.offset));
    if (filters.characterId)
      params.set('characterId', String(filters.characterId));
    const qs = params.toString();
    const path = `/tasks${qs ? `?${qs}` : ''}`;
    return consoleFetch<PlanPage>(path, { signal });
  },

  get: (planId: string, signal?: AbortSignal) =>
    consoleFetch<PublicPlanView>(`/tasks/${encodeURIComponent(planId)}`, {
      signal,
    }),

  save: (
    characterId: string,
    draft: TaskPlanDraft,
    previous?: TaskPlan,
    requestId?: string,
  ) => {
    const targetCharacterId = previous?.characterId ?? characterId;
    const body = { ...draft, requestId, characterId: targetCharacterId };
    if (previous?.id) {
      return consoleFetch<TaskPlan>(
        `/tasks/${encodeURIComponent(previous.id)}`,
        {
          method: 'PUT',
          body,
        },
      );
    }
    return consoleFetch<TaskPlan>('/tasks', {
      method: 'POST',
      body,
    });
  },

  delete: (planId: string, characterId?: string) =>
    consoleFetch<void>(`/tasks/${encodeURIComponent(planId)}`, {
      method: 'DELETE',
    }),

  control: (
    plan: TaskPlan,
    operation: string,
    value: Record<string, unknown> = {},
    expectedTask?: TaskIdentity | null,
  ) => {
    const path = `/tasks/${encodeURIComponent(plan.id)}/${encodeURIComponent(operation)}`;
    return consoleFetch(path, {
      method: 'POST',
      body: {
        ...value,
        characterId: plan.characterId,
        expectedPlanRevision: plan.revision,
        expectedTask,
      },
    });
  },

  reassign: (plan: TaskPlan, targetCharacterId: string) =>
    consoleFetch(`/tasks/${encodeURIComponent(plan.id)}/reassign`, {
      method: 'POST',
      body: { targetCharacterId },
    }),

  runs: (planId: string, offset = 0, signal?: AbortSignal) => {
    const qs = offset ? `?offset=${offset}` : '';
    return consoleFetch<TaskRunPage>(
      `/tasks/${encodeURIComponent(planId)}/runs${qs}`,
      { signal },
    );
  },

  controlRun: (
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
    ),
};

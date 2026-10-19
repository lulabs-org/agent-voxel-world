import type {
  ManagedAgentView,
  TaskPlan,
  TaskPlanDraft,
  TaskRunPage,
} from '@voxel/shared';
import type {
  PublicAgentView,
  PublicPlanView,
  RpcParams,
  TaskIdentity,
} from '@voxel/gateway-protocol';
import { consoleFetch } from '../request';

export const displayedTaskIdentity = (
  view?: ManagedAgentView,
): TaskIdentity | null =>
  (view as PublicAgentView | undefined)?.taskIdentity ?? null;

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
    if (filters.offset !== undefined) params.set('offset', String(filters.offset));
    if (filters.agentId) params.set('agentId', String(filters.agentId));
    const qs = params.toString();
    const path = filters.agentId
      ? `/${encodeURIComponent(String(filters.agentId))}/tasks${qs ? `?${qs}` : ''}`
      : `/tasks${qs ? `?${qs}` : ''}`;
    return consoleFetch<PlanPage>(path, { signal });
  },

  get: (planId: string, signal?: AbortSignal) =>
    consoleFetch<PublicPlanView>(`/tasks/${encodeURIComponent(planId)}`, {
      signal,
    }),

  save: (
    agentId: string,
    draft: TaskPlanDraft,
    previous?: TaskPlan,
    requestId?: string,
  ) => {
    const targetAgentId = previous?.agentId ?? agentId;
    const body = { ...draft, requestId };
    if (previous?.id) {
      const path = targetAgentId
        ? `/${encodeURIComponent(targetAgentId)}/tasks/${encodeURIComponent(previous.id)}`
        : `/tasks/${encodeURIComponent(previous.id)}`;
      return consoleFetch<TaskPlan>(path, {
        method: 'PUT',
        body,
      });
    }
    const path = targetAgentId
      ? `/${encodeURIComponent(targetAgentId)}/tasks`
      : '/tasks';
    return consoleFetch<TaskPlan>(path, {
      method: 'POST',
      body,
    });
  },

  delete: (planId: string, agentId?: string) =>
    consoleFetch<void>(
      agentId
        ? `/${encodeURIComponent(agentId)}/tasks/${encodeURIComponent(planId)}`
        : `/tasks/${encodeURIComponent(planId)}`,
      { method: 'DELETE' },
    ),

  control: (
    plan: TaskPlan,
    operation: string,
    value: Record<string, unknown> = {},
    expectedTask?: TaskIdentity | null,
  ) => {
    const path = plan.agentId
      ? `/${encodeURIComponent(plan.agentId)}/tasks/${encodeURIComponent(plan.id)}/${encodeURIComponent(operation)}`
      : `/tasks/${encodeURIComponent(plan.id)}/${encodeURIComponent(operation)}`;
    return consoleFetch(path, {
      method: 'POST',
      body: {
        ...value,
        expectedPlanRevision: plan.revision,
        expectedTask,
      },
    });
  },

  reassign: (plan: TaskPlan, targetAgentId: string) => {
    const path = plan.agentId
      ? `/${encodeURIComponent(plan.agentId)}/tasks/${encodeURIComponent(plan.id)}/reassign`
      : `/tasks/${encodeURIComponent(plan.id)}/reassign`;
    return consoleFetch(path, {
      method: 'POST',
      body: { targetAgentId },
    });
  },

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

import type { TaskIdentity, PublicAgentView } from '@voxel/gateway-protocol';
import type { ManagedAgentView } from '@voxel/shared';
export const displayedTaskIdentity = (
  view: ManagedAgentView,
): TaskIdentity | null => (view as PublicAgentView).taskIdentity ?? null;
import type { TaskPlan, TaskPlanDraft, TaskRunPage } from '@voxel/shared';
import { agentPath, request } from '../request';
import type { TaskBudget } from '../tasks/model';
export const tasksApi = {
  listTaskPlans: (id: string, signal?: AbortSignal) =>
    request<TaskPlan[]>(`${agentPath(id)}/tasks`, 'GET', undefined, signal),
  saveTaskPlan: (
    id: string,
    draft: TaskPlanDraft,
    planId?: string,
    requestId?: string,
  ) =>
    request<TaskPlan>(
      `${agentPath(id)}/tasks${planId ? `/${encodeURIComponent(planId)}` : ''}`,
      planId ? 'PUT' : 'POST',
      { ...draft, requestId },
    ),
  taskPlanAction: (
    id: string,
    planId: string,
    operation: 'run' | 'pause' | 'resume' | 'archive' | 'extend',
    body: unknown = {},
    expectedTask?: TaskIdentity | null,
  ) =>
    request<void>(
      `${agentPath(id)}/tasks/${encodeURIComponent(planId)}/${operation}`,
      'POST',
      body,
      undefined,
      expectedTask,
    ),
  listTaskRuns: (
    id: string,
    planId: string,
    offset = 0,
    signal?: AbortSignal,
  ) =>
    request<TaskRunPage>(
      `${agentPath(id)}/tasks/${encodeURIComponent(planId)}/runs?offset=${offset}`,
      'GET',
      undefined,
      signal,
    ),
  taskRunAction: (
    id: string,
    runId: string,
    operation: 'pause' | 'resume' | 'cancel',
    limits?: TaskBudget,
    expectedTask?: TaskIdentity | null,
  ) =>
    request<void>(
      `${agentPath(id)}/task-runs/${encodeURIComponent(runId)}/${operation}`,
      'POST',
      limits ?? {},
      undefined,
      expectedTask,
    ),
  resumeAgent: (
    id: string,
    limits?: TaskBudget,
    expectedTask?: TaskIdentity | null,
  ) =>
    request<void>(
      `${agentPath(id)}/resume`,
      'POST',
      limits ?? {},
      undefined,
      expectedTask,
    ),
  pauseAgent: (id: string, expectedTask?: TaskIdentity | null) =>
    request<void>(
      `${agentPath(id)}/pause`,
      'POST',
      {},
      undefined,
      expectedTask,
    ),
  cancelTask: (id: string, expectedTask?: TaskIdentity | null) =>
    request<void>(
      `${agentPath(id)}/cancel`,
      'POST',
      {},
      undefined,
      expectedTask,
    ),
  assignTask: (
    id: string,
    goal: string,
    limits?: TaskBudget,
    expectedTask?: TaskIdentity | null,
  ) =>
    request<void>(
      `${agentPath(id)}/task`,
      'POST',
      { goal, ...limits },
      undefined,
      expectedTask,
    ),
};

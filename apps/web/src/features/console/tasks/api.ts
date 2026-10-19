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
import { gatewayRequest } from '../../../network/gateway';
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
  list: (filters: RpcParams = {}, signal?: AbortSignal) =>
    gatewayRequest<PlanPage>('plans.list', filters, signal),
  get: (planId: string, signal?: AbortSignal) =>
    gatewayRequest<PublicPlanView>('plans.get', { planId }, signal),
  save: (
    agentId: string,
    draft: TaskPlanDraft,
    previous?: TaskPlan,
    requestId?: string,
  ) =>
    gatewayRequest<TaskPlan>(previous ? 'plans.update' : 'plans.create', {
      agentId: previous ? previous.agentId : agentId,
      planId: previous?.id,
      expectedPlanRevision: previous?.revision,
      value: { ...draft, requestId },
    }),
  control: (
    plan: TaskPlan,
    operation: string,
    value: Record<string, unknown> = {},
    expectedTask?: TaskIdentity | null,
  ) =>
    gatewayRequest('plans.control', {
      planId: plan.id,
      expectedPlanRevision: plan.revision,
      operation,
      value,
      expectedTask,
    }),
  reassign: (plan: TaskPlan, targetAgentId: string) =>
    gatewayRequest('plans.reassign', {
      planId: plan.id,
      expectedPlanRevision: plan.revision,
      targetAgentId,
    }),
  runs: (planId: string, offset = 0, signal?: AbortSignal) =>
    gatewayRequest<TaskRunPage>('runs.list', { planId, offset }, signal),
  controlRun: (
    runId: string,
    operation: string,
    value: Record<string, unknown>,
    expectedTask: TaskIdentity | null,
  ) =>
    gatewayRequest('runs.control', { runId, operation, value, expectedTask }),
};

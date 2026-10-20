import type { PlanQueryFilter } from './types';

/**
 * Tasks / Plans 领域的管理接口契约（由 AgentManager / TaskStore 实现）
 */
export interface TaskPort {
  planPage(params: PlanQueryFilter): unknown;
  publicPlans(agentId?: string): unknown;
  publicPlan(planId: string): unknown;
  createTaskPlan(agentId: string, value: unknown): Promise<unknown>;
  updateTaskPlan(
    agentId: string | undefined,
    planId: string,
    value: unknown,
  ): Promise<unknown>;
  controlTaskPlan(
    agentId: string | undefined,
    planId: string,
    operation: string,
    value: unknown,
  ): Promise<unknown>;
  reassignPlan(planId: string, targetAgentId: string): Promise<unknown>;
  publicRuns(
    agentId: string | undefined,
    planId: string,
    offset?: number,
    metadata?: boolean,
  ): unknown;
  controlTaskRun(
    agentId: string | undefined,
    runId: string,
    operation: string,
    value: unknown,
  ): Promise<unknown>;
}

export type TasksManagerPort = TaskPort;

/**
 * Tasks 业务服务封装（兼容适配器）
 */
export class TasksService {
  constructor(private readonly manager: TaskPort) {}

  listGlobalPlans(params: PlanQueryFilter) {
    return this.manager.planPage(params);
  }

  listAgentPlans(agentId: string) {
    return this.manager.publicPlans(agentId);
  }

  getPlan(planId: string) {
    return this.manager.publicPlan(planId);
  }

  createPlan(agentId: string, value: unknown) {
    return this.manager.createTaskPlan(agentId, value);
  }

  updatePlan(agentId: string | undefined, planId: string, value: unknown) {
    return this.manager.updateTaskPlan(agentId, planId, value);
  }

  deletePlan(agentId: string | undefined, planId: string) {
    return this.manager.controlTaskPlan(agentId, planId, 'delete', {});
  }

  reassignPlan(planId: string, targetAgentId: string) {
    return this.manager.reassignPlan(planId, targetAgentId);
  }

  listRuns(
    agentId: string | undefined,
    planId: string,
    offset = 0,
    metadata = true,
  ) {
    return this.manager.publicRuns(agentId, planId, offset, metadata);
  }

  controlPlan(
    agentId: string | undefined,
    planId: string,
    operation: string,
    value: unknown,
  ) {
    return this.manager.controlTaskPlan(agentId, planId, operation, value);
  }

  controlRun(
    agentId: string | undefined,
    runId: string,
    operation: string,
    value: unknown,
  ) {
    return this.manager.controlTaskRun(agentId, runId, operation, value);
  }
}

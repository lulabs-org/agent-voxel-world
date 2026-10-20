import type { PlanQueryFilter } from './types';

/**
 * Tasks / Plans 领域的管理接口契约（由 TaskCoordinator 实现）
 */
export interface TaskPort {
  planPage(params: PlanQueryFilter): unknown;
  publicPlans(agentId?: string, metadata?: boolean): unknown;
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
 * Tasks 的 HTTP 适配服务
 */
export class TasksService {
  constructor(private readonly tasks: TaskPort) {}

  listGlobalPlans(params: PlanQueryFilter) {
    return this.tasks.planPage(params);
  }

  listAgentPlans(agentId: string) {
    return this.tasks.publicPlans(agentId);
  }

  getPlan(planId: string) {
    return this.tasks.publicPlan(planId);
  }

  createPlan(agentId: string, value: unknown) {
    return this.tasks.createTaskPlan(agentId, value);
  }

  updatePlan(agentId: string | undefined, planId: string, value: unknown) {
    return this.tasks.updateTaskPlan(agentId, planId, value);
  }

  deletePlan(agentId: string | undefined, planId: string) {
    return this.tasks.controlTaskPlan(agentId, planId, 'delete', {});
  }

  reassignPlan(planId: string, targetAgentId: string) {
    return this.tasks.reassignPlan(planId, targetAgentId);
  }

  listRuns(
    agentId: string | undefined,
    planId: string,
    offset = 0,
    metadata = true,
  ) {
    return this.tasks.publicRuns(agentId, planId, offset, metadata);
  }

  controlPlan(
    agentId: string | undefined,
    planId: string,
    operation: string,
    value: unknown,
  ) {
    return this.tasks.controlTaskPlan(agentId, planId, operation, value);
  }

  controlRun(
    agentId: string | undefined,
    runId: string,
    operation: string,
    value: unknown,
  ) {
    return this.tasks.controlTaskRun(agentId, runId, operation, value);
  }
}

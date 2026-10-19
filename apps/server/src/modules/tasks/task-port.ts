import type { RpcParams } from '@voxel/gateway-protocol';

export interface TasksManagerPort {
  planPage(params: {
    state?: RpcParams['state'];
    offset?: number;
    search?: string;
    agentId?: string;
  }): unknown;
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
    agentId: string,
    runId: string,
    operation: string,
    value: unknown,
  ): Promise<unknown>;
}
export type TaskPort = TasksManagerPort;

/**
 * Tasks / Plans 领域的业务服务封装
 */
export class TasksService {
  constructor(private readonly manager: TasksManagerPort) {}

  listGlobalPlans(params: {
    state?: RpcParams['state'];
    offset?: number;
    search?: string;
    agentId?: string;
  }) {
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
    agentId: string,
    runId: string,
    operation: string,
    value: unknown,
  ) {
    return this.manager.controlTaskRun(agentId, runId, operation, value);
  }
}

import type { PlanQueryFilter } from './types';

/**
 * Tasks / Plans 领域的管理接口契约（由 TaskCoordinator 实现）
 */
export interface TaskPort {
  planPage(params: PlanQueryFilter): unknown;
  publicPlans(characterId?: string, metadata?: boolean): unknown;
  publicPlan(planId: string): unknown;
  createTaskPlan(characterId: string, value: unknown): Promise<unknown>;
  updateTaskPlan(
    characterId: string | undefined,
    planId: string,
    value: unknown,
  ): Promise<unknown>;
  controlTaskPlan(
    characterId: string | undefined,
    planId: string,
    operation: string,
    value: unknown,
  ): Promise<unknown>;
  reassignPlan(planId: string, targetCharacterId: string): Promise<unknown>;
  publicRuns(
    characterId: string | undefined,
    planId: string,
    offset?: number,
    metadata?: boolean,
  ): unknown;
  controlTaskRun(
    characterId: string | undefined,
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

  listAgentPlans(characterId: string) {
    return this.tasks.publicPlans(characterId);
  }

  getPlan(planId: string) {
    return this.tasks.publicPlan(planId);
  }

  createPlan(characterId: string, value: unknown) {
    return this.tasks.createTaskPlan(characterId, value);
  }

  updatePlan(characterId: string | undefined, planId: string, value: unknown) {
    return this.tasks.updateTaskPlan(characterId, planId, value);
  }

  deletePlan(characterId: string | undefined, planId: string) {
    return this.tasks.controlTaskPlan(characterId, planId, 'delete', {});
  }

  reassignPlan(planId: string, targetCharacterId: string) {
    return this.tasks.reassignPlan(planId, targetCharacterId);
  }

  listRuns(
    characterId: string | undefined,
    planId: string,
    offset = 0,
    metadata = true,
  ) {
    return this.tasks.publicRuns(characterId, planId, offset, metadata);
  }

  controlPlan(
    characterId: string | undefined,
    planId: string,
    operation: string,
    value: unknown,
  ) {
    return this.tasks.controlTaskPlan(characterId, planId, operation, value);
  }

  controlRun(
    characterId: string | undefined,
    runId: string,
    operation: string,
    value: unknown,
  ) {
    return this.tasks.controlTaskRun(characterId, runId, operation, value);
  }
}

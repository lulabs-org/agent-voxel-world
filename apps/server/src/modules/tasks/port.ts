import type { PlanQueryFilter } from './domain/types';

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
  reassignPlan(
    planId: string,
    targetCharacterId: string,
    value?: unknown,
  ): Promise<unknown>;
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

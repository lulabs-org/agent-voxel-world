import { randomUUID } from 'node:crypto';
import {
  nextOccurrence,
  type TaskPlanDraft,
  type TaskPlan,
  type TaskRun,
} from '@voxel/shared';
import type { StoredRun, TaskBook } from './task-types';

export { nextOccurrence, wallClockInstant } from '@voxel/shared';
export { validatePlan } from './task-validation';
export type { StoredRun, TaskBook } from './task-types';

/**
 * 创建空的持久化任务簿
 */
export const emptyTaskBook = (): TaskBook => ({
  version: 1,
  plans: [],
  runs: [],
});

/**
 * 判断指定运行是否已经结束（不再处于活跃/待命状态）
 */
export const endedRun = (r: Pick<TaskRun, 'status'>): boolean =>
  ['completed', 'cancelled', 'missed', 'skipped'].includes(r.status);

/**
 * 转换并提取向客户端展示的公共 TaskRun 视图（剔除敏感及运行时内部字段）
 */
export function runView(run: StoredRun): TaskRun {
  const { runtime, accountedTokens, requestId, lastBatch, ...view } = run;
  return structuredClone({
    ...view,
    requiresReassignment: runtime?.audienceExpired,
  });
}

/**
 * 提取纯净的任务草稿配置（用于快照保存或版本对比）
 */
export function planDraft(plan: TaskPlanDraft): TaskPlanDraft {
  const { name, goal, timing, timeZone, limits, totalTokenBudget } = plan;
  return structuredClone({
    name,
    goal,
    timing,
    timeZone,
    limits,
    totalTokenBudget,
  });
}

/**
 * 基于草稿创建全新任务计划实体
 */
export function newPlan(draft: TaskPlanDraft, now: number): TaskPlan {
  const plan: TaskPlan = {
    ...planDraft(draft),
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    state: 'enabled',
    reason: '',
    spentTokens: 0,
    revision: 1,
  };
  plan.nextRunAt = nextOccurrence(plan, now);
  return plan;
}

/**
 * 基于任务计划创建新的执行记录实体
 */
export function newRun(
  plan: TaskPlan,
  at: number,
  source: TaskRun['source'],
): StoredRun {
  return {
    id: randomUUID(),
    planId: plan.id,
    planRevision: plan.revision ?? 1,
    agentId: plan.agentId,
    agentName: plan.agentName,
    source,
    scheduledAt: at,
    snapshot: planDraft(plan),
    status: 'running',
    reason: '',
    totalTokens: 0,
    accountedTokens: 0,
    logs: [],
  };
}

/**
 * 查询任务簿中到期且待触发的任务计划，按下次执行时间与创建时间升序排列
 */
export function duePlans(book: Pick<TaskBook, 'plans'>, now: number): TaskPlan[] {
  return book.plans
    .filter(
      (p) =>
        p.state === 'enabled' &&
        p.nextRunAt !== undefined &&
        p.nextRunAt <= now,
    )
    .sort((a, b) => a.nextRunAt! - b.nextRunAt! || a.createdAt - b.createdAt);
}

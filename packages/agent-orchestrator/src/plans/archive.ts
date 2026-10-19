import { isRepeating } from '@voxel/shared';
import type { GatewayArchive, RestoredAgentRecord } from '../ports';
import { newPlan, newRun } from './model';
import { DEFAULT_TASK_LIMITS } from '@voxel/shared';
import { ManagementError } from '../errors';
/** Pure, repeatable migration; disk backup and atomic replacement belong to the host. */
export function migrateArchive(
  saved: RestoredAgentRecord[] | GatewayArchive,
): GatewayArchive {
  if (!Array.isArray(saved)) {
    if (
      saved.version !== 1 ||
      !Array.isArray(saved.agents) ||
      !Array.isArray(saved.plans) ||
      !Array.isArray(saved.runs) ||
      !saved.requests ||
      typeof saved.requests !== 'object'
    )
      throw new ManagementError('网关存档格式无效。', 500);
    const copy = structuredClone(saved);
    validateArchive(copy);
    return copy;
  }
  const result: GatewayArchive = {
    version: 1,
    agents: [],
    plans: [],
    runs: [],
    requests: {},
  };
  for (const original of saved) {
    const a = structuredClone(original),
      book = a.taskBook;
    if (book) {
      if (
        book.version !== 1 ||
        !Array.isArray(book.plans) ||
        !Array.isArray(book.runs)
      )
        throw new ManagementError('任务存档格式无效。', 500);
      for (const p of book.plans) {
        const runs = book.runs.filter((r) => r.planId === p.id);
        const chatOnly =
          p.timing.kind === 'immediate' &&
          !Object.values(book.requests ?? {}).includes(p.id) &&
          runs.length > 0 &&
          runs.every((r) => r.source === 'chat');
        if (chatOnly) {
          for (const r of runs) delete r.planId;
        } else
          result.plans.push({
            ...p,
            agentId: a.id,
            agentName: a.name,
            revision: p.revision ?? 1,
            imported:
              !isRepeating(p.timing) &&
              !runs.some((r) => ['manual', 'scheduled'].includes(r.source)),
          });
      }
      for (const r of book.runs)
        result.runs.push({
          ...r,
          agentId: a.id,
          agentName: a.name,
          planRevision: r.planId ? (r.planRevision ?? 1) : undefined,
        });
      for (const [key, id] of Object.entries(book.requests ?? {}))
        result.requests[`${a.id}:${key}`] = id;
      a.currentRunId = book.currentRunId;
    }
    if (!book && (a.runtime?.task || a.task)) {
      const task = a.runtime?.task ?? a.task!;
      const p = {
        ...newPlan(
          {
            name: task.goal.slice(0, 80) || '历史导入',
            goal: task.goal,
            timing: { kind: 'immediate' },
            timeZone: 'UTC',
            limits: { ...DEFAULT_TASK_LIMITS },
            totalTokenBudget: 500000,
          },
          task.startedAt,
        ),
        agentId: a.id,
        agentName: a.name,
        imported: true,
      };
      const r = newRun(p, task.startedAt, 'legacy');
      r.task = structuredClone(task);
      r.runtime = a.runtime
        ? structuredClone(a.runtime)
        : { task: structuredClone(task) };
      r.status = task.status;
      r.totalTokens = task.tokens;
      r.accountedTokens = task.tokens;
      p.spentTokens = task.tokens;
      result.plans.push(p);
      result.runs.push(r);
      a.currentRunId = r.id;
    }
    delete a.taskBook;
    result.agents.push(a);
  }
  validateArchive(result);
  return result;
}
function validateArchive(s: GatewayArchive) {
  for (const list of [s.agents, s.plans, s.runs]) {
    const ids = list.map((x) => x.id);
    if (
      ids.some((id) => typeof id !== 'string' || !id) ||
      new Set(ids).size !== ids.length
    )
      throw new ManagementError('存档资源标识重复或无效。', 500);
  }
  for (const p of s.plans)
    if (p.agentId && !s.agents.some((a) => a.id === p.agentId))
      throw new ManagementError('计划关联角色不存在。', 500);
  for (const r of s.runs)
    if (r.planId && !s.plans.some((p) => p.id === r.planId))
      throw new ManagementError('执行关联计划不存在。', 500);
  for (const a of s.agents)
    if (
      a.currentRunId &&
      !s.runs.some((r) => r.id === a.currentRunId && r.agentId === a.id)
    )
      throw new ManagementError('当前执行关联无效。', 500);
}

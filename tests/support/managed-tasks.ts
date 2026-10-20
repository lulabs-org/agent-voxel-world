import type { AICharacterManager } from '../../apps/server/src/modules/ai-characters';

/** Test setup names every new task explicitly; it never pauses or replaces an existing execution. */
export async function startTask(
  manager: AICharacterManager,
  id: string,
  value: {
    goal: string;
    maxTurns?: number;
    tokenBudget?: number;
    taskTimeoutMs?: number;
  },
) {
  const agent = manager.list().find((a) => a.id === id)!;
  return manager.tasks.createTaskPlan(id, {
    name: value.goal.slice(0, 80),
    goal: value.goal,
    timing: { kind: 'immediate' },
    timeZone: 'UTC',
    limits: {
      maxTurns: value.maxTurns ?? agent.maxTurns,
      tokenBudget: value.tokenBudget ?? agent.tokenBudget,
      taskTimeoutMs: value.taskTimeoutMs ?? agent.taskTimeoutMs,
    },
  });
}

/** Resolve the ID as test setup; the production command always targets the specified run. */
export function controlRun(
  manager: AICharacterManager,
  id: string,
  operation: 'pause' | 'cancel' | 'resume',
  value: Record<string, unknown> = {},
) {
  return manager.tasks.controlTaskRun(
    id,
    manager.currentRunId(id)!,
    operation,
    value,
  );
}

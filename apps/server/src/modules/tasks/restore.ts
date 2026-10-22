import {
  newTask,
  restoreBatchHistory,
  restoreCheckpoint,
  type AgentRunState,
} from '@voxel/agent-runtime';
import { isRepeating, type AICharacterTask } from '@voxel/shared';
import { duePlans, endedRun, newRun, nextOccurrence } from './model';
import { captureTask } from './execution';
import type { TaskExecutionState } from './execution-port';

/** Read compatibility only. New task creation must use the task service. */
export function restoreTaskMemory(
  runtime: AgentRunState | undefined,
  task: AICharacterTask | undefined,
  goal: string,
): AgentRunState {
  return (
    runtime ?? {
      task: task ?? {
        ...newTask(goal),
        status: 'paused',
        reason: '旧任务已迁移，请确认后继续。',
      },
    }
  );
}

/** Restore task policy without starting a host, replaying unknown actions or dispatching missed triggers. */
export function restoreTaskExecution(
  job: TaskExecutionState,
  migrating: boolean,
) {
  if (job.memory.activeAction?.status === 'running')
    job.memory.activeAction.status = 'unknown';
  // World-session recipients cannot survive a restart. Retain audit, never replay old chat.
  for (const event of job.memory.inbox?.events ?? []) {
    if (event.kind === 'chat' || event.state === 'processing')
      event.state = 'unknown';
  }
  if (job.memory.exchanges) {
    const publicHistory = job.memory.exchanges.public;
    job.memory.exchanges = publicHistory ? { public: publicHistory } : {};
  }
  job.memory.previous = restoreBatchHistory(job.memory.previous);
  restoreCheckpoint(job.memory);
  if (
    job.memory.task &&
    ['running', 'waiting'].includes(job.memory.task.status)
  ) {
    job.memory.task.status = 'paused';
    job.memory.task.reason = '服务重启，任务进度已保留，请手动继续。';
  }
  if (job.memory.task && !job.memory.task.privateTo)
    delete job.memory.task.owner;
  if (
    job.memory.task?.privateTo &&
    !['completed', 'cancelled'].includes(job.memory.task.status)
  ) {
    job.memory.audienceExpired = true;
    job.memory.task.status = 'needs_input';
    job.memory.task.reason = '服务重启后原私聊会话已失效，请重新通过聊天发起。';
  }
  const interruptedRuns = new Set(
    job.ledger.runs
      .filter((r) => r.characterId === job.view.id)
      .filter((r) =>
        [
          'running',
          'waiting',
          'failed',
          'budget',
          'blocked',
          'needs_input',
        ].includes(r.status),
      )
      .map((r) => r.id),
  );
  captureTask(job);

  for (const run of job.ledger.runs.filter(
    (r) => r.characterId === job.view.id,
  )) {
    if (run.runtime) {
      restoreCheckpoint(run.runtime);
      if (run.runtime.activeAction?.status === 'running')
        run.runtime.activeAction.status = 'unknown';
      for (const event of run.runtime.inbox?.events ?? [])
        if (event.kind === 'chat' || event.state === 'processing')
          event.state = 'unknown';
      if (run.runtime.exchanges) {
        const publicHistory = run.runtime.exchanges.public;
        run.runtime.exchanges = publicHistory ? { public: publicHistory } : {};
      }
    }
    for (const action of run.actions ?? [])
      if (action.status === 'executing') action.status = 'unknown';
    if (run.runtime?.previous)
      run.runtime.previous = restoreBatchHistory(run.runtime.previous);
    if (run.runtime?.task?.privateTo && !endedRun(run)) {
      run.runtime.audienceExpired = true;
      run.runtime.task.status = 'needs_input';
      run.runtime.task.reason = '原私聊会话已失效，请重新通过聊天发起。';
      run.status = 'needs_input';
      run.task = structuredClone(run.runtime.task);
    }
    if (['running', 'waiting'].includes(run.status)) {
      run.status = 'paused';
      run.reason = '服务重启，进度保留，请手动继续。';
      if (run.runtime?.task) {
        run.runtime.task.status = 'paused';
        run.runtime.task.reason = run.reason;
        run.task = structuredClone(run.runtime.task);
      }
    }
    if (
      !endedRun(run) &&
      (migrating || interruptedRuns.has(run.id) || run.runtime?.audienceExpired)
    ) {
      const p = job.ledger.plans.find((p) => p.id === run.planId);
      if (p) {
        p.state = 'paused';
        p.reason = '执行尚未结束，请确认后恢复计划。';
        delete p.nextRunAt;
      }
    }
  }

  for (const plan of duePlans(job.ledger, Date.now()).filter(
    (p) => p.characterId === job.view.id,
  )) {
    const run = newRun(
      { ...plan, characterName: job.view.name },
      plan.nextRunAt!,
      'scheduled',
    );
    run.status = isRepeating(plan.timing) ? 'skipped' : 'missed';
    run.reason = '服务未运行，错过的触发不补跑。';
    run.finishedAt = Date.now();
    job.ledger.runs.push(run);
    plan.nextRunAt = nextOccurrence(plan, Date.now());
    if (!isRepeating(plan.timing)) plan.state = 'completed';
  }
}

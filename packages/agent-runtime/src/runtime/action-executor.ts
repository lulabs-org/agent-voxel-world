import { paceChat } from './chat-pacing';
import { agentPermissions, key } from '@voxel/shared';
import type {
  AgentAction,
  AgentSession,
  AgentConfig,
  Observation,
} from '../contracts';
import type { AgentRunState } from '../task/state';
import { TaskService, type TaskLease } from '../task/service';
import type { AgentAttention } from './attention';
import { executeBatch } from '../actions/batch';
import { houseBlocks } from '../actions/building';
import type { RequestBudget } from '../task/budget';

/** Executes world effects only. Task commands and conversation never enter this boundary. */
export async function executeTaskActions(
  session: AgentSession,
  actions: AgentAction[],
  observation: Observation,
  config: AgentConfig,
  signal: AbortSignal,
  memory: AgentRunState,
  budget: RequestBudget,
  lease: TaskLease,
  checkpoint: () => Promise<void>,
  attention?: AgentAttention,
  log: (message: string) => void = () => {},
) {
  const service = new TaskService(memory);
  service.assertCurrent(lease);
  signal.throwIfAborted();
  const guardedSession: AgentSession = {
    observe: () => {
      service.assertCurrent(lease);
      return session.observe();
    },
    move: (x, z, jump) => {
      if (x || z || jump) service.assertCurrent(lease);
      session.move(x, z, jump);
    },
    request: (type, payload) => {
      service.assertCurrent(lease);
      return session.request(type, payload);
    },
  };
  const task = memory.task!;
  const routed = actions.map(
    (action): AgentAction =>
      action.type === 'chat' && task.privateTo
        ? { ...action, scope: 'private', recipients: [task.privateTo] }
        : action,
  );
  const actionLimit = new AbortController();
  const remaining = Math.max(1, budget.remainingMs);
  const timer = Number.isFinite(remaining)
    ? setTimeout(() => actionLimit.abort(), remaining)
    : undefined;
  let outcome;
  // Keep older unfinished coordinates when a new batch only works on a subset.
  const priorBuild = memory.unfinishedBuild;
  const followControl = { pursuing: true };
  try {
    outcome = await executeBatch(
      guardedSession,
      routed,
      observation,
      agentPermissions(config),
      AbortSignal.any([signal, actionLimit.signal]),
      {
        navigation: { follow: followControl },
        pending: () => !!attention?.pending,
        log,
        beforeAction: async (action) => {
          service.assertCurrent(lease);
          signal.throwIfAborted();
          if (action.type === 'chat') await paceChat(memory, signal);
          if (action.type === 'follow') {
            memory.follow = {
              action,
              taskStartedAt: task.startedAt,
              pursuing: true,
            };
            await checkpoint();
          }
          if (action.type === 'goto') delete memory.follow;
          if (action.type === 'build' || action.type === 'house') {
            const blocks =
              action.type === 'house' ? houseBlocks(action) : action.blocks;
            const extra =
              priorBuild?.result.remaining.filter(
                (b) => !blocks.some((p) => key(p) === key(b)),
              ) ?? [];
            memory.unfinishedBuild = {
              action,
              result: {
                ok: false,
                total: blocks.length + extra.length,
                completed: 0,
                skipped: 0,
                remaining: [...extra, ...blocks],
                failures: [],
                note: '执行中；未确认的动作不会自动重放。',
              },
            };
            await checkpoint();
          }
        },
        buildCheckpoint: (action, result) => {
          service.assertCurrent(lease);
          const blocks =
            action.type === 'house' ? houseBlocks(action) : action.blocks;
          const extra =
            priorBuild?.result.remaining.filter(
              (b) => !blocks.some((p) => key(p) === key(b)),
            ) ?? [];
          const merged = {
            ...result,
            remaining: [...extra, ...result.remaining],
            ok: result.ok && !extra.length,
            total: result.total + extra.length,
            uncertain: [
              ...(priorBuild?.result.uncertain?.filter((b) =>
                extra.some((p) => key(p) === key(b)),
              ) ?? []),
              ...(result.uncertain ?? []),
            ],
          };
          memory.unfinishedBuild = merged.ok
            ? undefined
            : { action, result: merged };
        },
        checkpoint: async (batch) => {
          service.assertCurrent(lease);
          memory.previous = batch;
          // Confirmed individual edits can also finish part of an older blueprint.
          if (memory.unfinishedBuild) {
            memory.unfinishedBuild.result.remaining =
              memory.unfinishedBuild.result.remaining.filter(
                (b) =>
                  !batch.results.some(
                    (r) =>
                      r.status === 'succeeded' &&
                      r.action.type === 'edit' &&
                      key(r.action) === key(b) &&
                      r.action.material === b.material,
                  ),
              );
            if (!memory.unfinishedBuild.result.remaining.length)
              memory.unfinishedBuild = undefined;
          }
          await checkpoint();
        },
      },
    );
  } finally {
    clearTimeout(timer);
  }
  service.assertCurrent(lease);
  const { batch, observation: finalObservation } = outcome;
  const followResult = batch.results.find(
    (r) => r.action.type === 'follow',
  )?.result;
  if (memory.follow && followResult && 'status' in followResult) {
    memory.follow.pursuing = followControl.pursuing;
    memory.follow.lastResult = followResult;
    if (!followResult.ok) delete memory.follow;
  }
  if (actionLimit.signal.aborted || budget.remainingMs <= 0) {
    batch.stopReason = 'timeout';
    batch.ok = false;
  }
  memory.previous = batch;
  if (batch.ok) delete memory.decisionError;
  await checkpoint();
  signal.throwIfAborted();
  return { batch, observation: finalObservation };
}

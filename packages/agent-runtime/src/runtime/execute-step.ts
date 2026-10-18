import { agentPermissions, key, type AgentTask } from '@voxel/shared';
import type {
  AgentSession,
  AgentConfig,
  AgentDecision,
  AgentAction,
} from '../contracts';
import type { AgentAttention } from './attention';
import type { AgentRunState } from '../task/state';
import { executeBatch } from '../actions/batch';
import { parseDecision } from '../task/decision';
import { AgentRuntimeError } from '../errors';
import { houseBlocks } from '../actions/building';
import { RequestBudget } from '../task/budget';
import type { DecisionContext } from '../task/observation';
import {
  prepareTaskTransition,
  completeTaskTransition,
} from '../task/transitions';

/** Apply validated task policy, execute effects, and checkpoint their confirmed results. */
export async function applyTaskDecision(
  session: AgentSession,
  input: AgentDecision,
  prepared: DecisionContext,
  config: AgentConfig,
  signal: AbortSignal,
  memory: AgentRunState,
  budget: RequestBudget,
  attention?: AgentAttention,
  log: (message: string) => void = () => {},
  checkpoint: () => void | Promise<void> = () => {},
  hooks?: { beforeNewTask?: (task: AgentTask) => Promise<void> },
  quiet = false,
) {
  const { addressed, observation } = prepared;
  const started = Date.now();
  const decisionSignal = signal;
  const notifySender = async (text: string) => {
    if (quiet || !addressed || signal.aborted || !agentPermissions(config).chat)
      return;
    await session.request('chat', {
      text: text.slice(0, 240),
      scope: 'private',
      recipients: [addressed.actor],
    });
  };

  signal.throwIfAborted();
  let decision;
  try {
    decision = parseDecision(input, agentPermissions(config));
  } catch (error) {
    throw new AgentRuntimeError(
      error instanceof Error ? error.message : '模型决策格式无效。',
    );
  }
  let actions = decision.actions;
  const d = decision.task;
  const transition = await prepareTaskTransition({
    directive: d,
    prepared,
    memory,
    config,
    budget,
    beforeNewTask: hooks?.beforeNewTask,
    sendControlReply: async (text) => {
      if (agentPermissions(config).chat)
        await session.request('chat', {
          text,
          scope: 'private',
          recipients: [addressed!.actor],
        });
    },
    notifySender,
  });
  if (transition.stopped) return;
  const { task, chargedTask } = transition;
  if (
    chargedTask &&
    chargedTask.elapsedMs + Date.now() - started >=
      (config.taskTimeoutMs ?? 900000)
  ) {
    chargedTask.status = 'budget';
    chargedTask.reason = '任务执行时间预算已耗尽，本次动作未执行。';
    await notifySender(chargedTask.reason);
    return;
  }
  if (
    d.intent !== 'reply' &&
    d.status === 'completed' &&
    memory.unfinishedBuild &&
    actions.every((a) => ['chat', 'wait'].includes(a.type))
  ) {
    d.status = 'blocked';
    d.summary = `仍有 ${memory.unfinishedBuild.result.remaining.length} 个方块未确认完成，已停止并保留进度。`;
    actions = [{ type: 'chat', text: d.summary }];
  }
  const routed = actions.map(
    (action): AgentAction =>
      action.type === 'chat' && !addressed && task?.privateTo
        ? { ...action, scope: 'private', recipients: [task.privateTo] }
        : action,
  );
  const actionLimit = new AbortController();
  const remaining = chargedTask
    ? Math.max(
        1,
        (config.taskTimeoutMs ?? 900000) -
          chargedTask.elapsedMs -
          (Date.now() - started),
      )
    : config.timeoutMs;
  const timer = Number.isFinite(remaining)
    ? setTimeout(() => actionLimit.abort(), remaining)
    : undefined;
  let outcome;
  // Keep older unfinished coordinates when a new batch only works on a subset.
  const priorBuild = memory.unfinishedBuild;
  const followControl = { pursuing: true };
  try {
    outcome = await executeBatch(
      session,
      routed,
      observation,
      agentPermissions(config),
      AbortSignal.any([decisionSignal, actionLimit.signal]),
      {
        navigation: { follow: followControl },
        pending: (index) =>
          (d.intent !== 'reply' || index > 0) && !!attention?.pending,
        log,
        beforeAction: async (action) => {
          if (chargedTask && action.type === 'follow') {
            memory.follow = {
              action,
              taskStartedAt: chargedTask.startedAt,
              pursuing: true,
            };
            await checkpoint();
          }
          if (action.type === 'goto') delete memory.follow;
          if (
            chargedTask &&
            (action.type === 'build' || action.type === 'house')
          ) {
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
          if (!chargedTask) return;
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
          if (d.intent !== 'reply') {
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
          } else memory.lastReply = batch;
          await checkpoint();
        },
      },
    );
  } finally {
    clearTimeout(timer);
  }
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
  if (d.intent !== 'reply') memory.previous = batch;
  else memory.lastReply = batch;
  await checkpoint();
  signal.throwIfAborted();
  memory.failures = 0;
  if (d.intent !== 'reply') memory.decisionError = undefined;
  const chats = batch.results.filter(
    (r) => r.status === 'succeeded' && r.action.type === 'chat',
  );
  if (d.intent === 'reply') {
    if (!chats.length)
      await notifySender(batch.ok ? d.summary : '本次回复未完成，请稍后重试。');
    const last = chats.at(-1)?.action;
    memory.lastResponse = last?.type === 'chat' ? last.text : d.summary;
    log(`消息已处理：${d.summary}`);
    return;
  }
  completeTaskTransition(task!, d, memory, batch, finalObservation, quiet);
  if (addressed && !chats.length)
    await notifySender(
      batch.ok
        ? `收到。${task!.summary}`
        : '收到指令，但这次动作未成功，我会根据执行结果判断下一步。',
    );
  log(`批次 · 任务${task!.status}：${task!.reason || task!.summary}`);
}

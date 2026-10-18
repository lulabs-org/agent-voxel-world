import { agentPermissions } from '@voxel/shared';
import type { AgentTask, ChatData } from '@voxel/shared';
import type {
  AgentSession,
  Observation,
  AgentConfig,
  AgentDecision,
  AgentAction,
} from '../contracts';
import type { AgentAttention } from './attention';
import { newTask, type AgentRunState } from './task';
import { executeBatch } from '../actions/batch';
import { parseDecision } from './decision';
import { AgentRuntimeError } from '../errors';
import { houseBlocks, observedEmpty } from '../actions/building';
import { key } from '@voxel/shared';
import { RequestBudget } from './budget';

export function worldSignature(o: Observation, kind: AgentTask['waitFor']) {
  return JSON.stringify(
    kind === 'players'
      ? (o.players ?? [])
          .map((p) => [
            p.id,
            Math.round(p.x * 2),
            Math.round(p.y * 2),
            Math.round(p.z * 2),
            p.connected,
          ])
          .sort()
      : (o.blocks ?? []).map((b) => [b.x, b.y, b.z, b.material]).sort(),
  );
}

export function cap(task: AgentTask, config: AgentConfig) {
  if (task.calls >= config.maxTurns)
    return '已达到任务调用上限，请检查进展后手动继续。';
  if (task.tokens >= (config.tokenBudget ?? 50000))
    return '已达到任务 token 预算，请检查进展后手动继续。';
  if (task.elapsedMs >= (config.taskTimeoutMs ?? 900000))
    return '已达到任务执行时间上限，请检查进展后手动继续。';
  return '';
}

export type DecisionContext = NonNullable<
  Awaited<ReturnType<typeof prepareDecision>>
>;
export async function prepareDecision(
  session: Pick<AgentSession, 'observe'>,
  memory: AgentRunState,
  signal: AbortSignal,
  addressed?: import('@voxel/shared').WorldEvent,
) {
  let task = memory.task;
  const raw = await session.observe();
  signal.throwIfAborted();
  if (
    !addressed &&
    task?.status === 'waiting' &&
    worldSignature(raw, task.waitFor) === memory.waitSignature
  )
    return undefined;
  if (memory.unfinishedBuild) {
    const observed = new Map(
      (raw.blocks ?? []).map((b) => [`${b.x},${b.y},${b.z}`, b.material]),
    );
    const remaining = memory.unfinishedBuild.result.remaining.filter((b) =>
      b.material !== null
        ? observed.get(key(b)) !== b.material
        : !observedEmpty(raw, b),
    );
    if (!remaining.length) memory.unfinishedBuild = undefined;
    else {
      memory.unfinishedBuild.result.remaining = remaining;
      memory.unfinishedBuild.result.uncertain =
        memory.unfinishedBuild.result.uncertain?.filter((b) =>
          remaining.some((p) => key(p) === key(b)),
        );
    }
  }
  if (memory.pendingEffects) {
    const resolved = memory.pendingEffects.results
      .filter((r) => !['pending', 'succeeded'].includes(r.status))
      .every((r) => {
        if (r.action.type === 'edit')
          return r.action.material === null
            ? observedEmpty(raw, r.action)
            : raw.blocks.some(
                (b) =>
                  key(b) ===
                    key(r.action as import('../contracts').PlannedEdit) &&
                  b.material ===
                    (r.action as import('../contracts').PlannedEdit).material,
              );
        if (r.action.type === 'move')
          return (
            !!r.before &&
            Math.hypot(
              raw.self.x - r.before.x,
              raw.self.y - r.before.y,
              raw.self.z - r.before.z,
            ) >= 0.05
          );
        if (r.action.type === 'build' || r.action.type === 'house')
          return !memory.unfinishedBuild;
        return false;
      });
    if (resolved) delete memory.pendingEffects;
  }
  const message = addressed?.data as ChatData | undefined;
  const privateTo =
    message && ['private', 'nearby'].includes(message.scope)
      ? addressed!.actor
      : undefined;
  // Conversation and task audiences are independent. A public question never sees a private task.
  const visibleTask =
    task &&
    (!task.privateTo || (addressed ? task.privateTo === privateTo : true));
  const observation = {
    ...raw,
    attention: addressed,
    events: addressed ? [addressed] : [],
  };
  const context = {
    task: visibleTask ? task : undefined,
    previous: visibleTask ? memory.previous : undefined,
    pendingEffects: visibleTask ? memory.pendingEffects : undefined,
    unfinishedBuild: visibleTask ? memory.unfinishedBuild : undefined,
    decisionError: visibleTask ? memory.decisionError : undefined,
    trigger: addressed
      ? 'message'
      : task?.status === 'waiting'
        ? 'condition_changed'
        : 'task',
  };
  return { task, addressed, observation, visibleTask, privateTo, context };
}

/** Shared world/task policy. No model request or inference loop lives here. */
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
  let { task } = prepared;
  const { addressed, observation, visibleTask, privateTo } = prepared;
  const started = Date.now();
  let chargedTask = !addressed ? task : undefined;
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
  // Some providers repeat the existing task as "task" or "update" on polls.
  // Only normalize the same goal, retaining identity, audience and all budgets.
  if (
    !addressed &&
    task &&
    (d.intent === 'task' || d.intent === 'update') &&
    (!d.goal || d.goal === task.goal)
  )
    d.intent = 'continue';
  if (!addressed && d.intent !== 'continue')
    throw new AgentRuntimeError(
      '自动推进必须使用 intent=continue，不能创建或替换任务目标。',
    );
  if (addressed && d.intent === 'continue')
    throw new AgentRuntimeError(
      '处理新消息时必须区分 reply、task、update 或任务控制，不能使用 continue。',
    );
  if (d.intent !== 'reply') {
    if (
      addressed &&
      task &&
      !['completed', 'cancelled'].includes(task.status) &&
      ((task.owner && task.owner !== addressed.actor) ||
        (task.privateTo && task.privateTo !== privateTo))
    ) {
      if (agentPermissions(config).chat)
        await session.request('chat', {
          text: '我还有正在处理的任务，请由任务发起者修改或取消，或在控制台安排新任务。',
          scope: 'private',
          recipients: [addressed.actor],
        });
      memory.lastResponse = '保留原任务：仅任务发起者可修改或取消。';
      throw new AgentRuntimeError(memory.lastResponse);
    }
    if (d.intent === 'task') {
      const nextTask = newTask(d.goal!, addressed!.actor, privateTo);
      await hooks?.beforeNewTask?.(nextTask);
      task = memory.task = nextTask;
      memory.previous = undefined;
      memory.pendingEffects = undefined;
      memory.unfinishedBuild = undefined;
      memory.noProgress = 0;
      memory.failures = 0;
      memory.lastProgress = undefined;
    } else if (!task || !visibleTask)
      throw new AgentRuntimeError(
        '没有可修改的任务，请使用 task 创建明确的新任务。',
      );
    if (d.intent === 'update' && d.goal) task!.goal = d.goal;
    chargedTask = task;
    budget.attach(task!);
    if (
      d.intent === 'resume' &&
      ['completed', 'cancelled', 'budget'].includes(task!.status)
    ) {
      // Budget extensions are operator-controlled, never reset by a chat loop.
      if (agentPermissions(config).chat)
        await session.request('chat', {
          text: '这个任务已结束或达到预算，请在控制台确认后继续或布置新任务。',
          scope: 'private',
          recipients: [addressed!.actor],
        });
      return;
    }
    if (!['pause', 'cancel'].includes(d.intent)) {
      const reason =
        task!.calls > config.maxTurns
          ? '已达到任务调用上限。'
          : task!.tokens >= (config.tokenBudget ?? 50000)
            ? '已达到任务 token 预算。'
            : budget.remainingMs <= 0
              ? '任务执行时间预算已耗尽。'
              : '';
      if (reason) {
        task!.status = 'budget';
        task!.reason = reason;
        await notifySender(reason);
        return;
      }
    }
  }
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
  try {
    outcome = await executeBatch(
      session,
      routed,
      observation,
      agentPermissions(config),
      AbortSignal.any([decisionSignal, actionLimit.signal]),
      {
        pending: (index) =>
          (d.intent !== 'reply' || index > 0) && !!attention?.pending,
        log,
        beforeAction: async (action) => {
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
  task!.summary = d.summary;
  task!.reason = d.status === 'running' ? '' : d.summary;
  task!.status =
    d.intent === 'pause'
      ? 'paused'
      : d.intent === 'cancel'
        ? 'cancelled'
        : d.status;
  task!.waitFor = 'waitFor' in d ? d.waitFor : undefined;
  const acted = batch.results.filter((r) => r.status !== 'pending');
  const mutated = acted.some((r) =>
    ['edit', 'build', 'house', 'move'].includes(r.action.type),
  );
  if (
    (mutated && task!.status === 'completed') ||
    (acted.some((r) => r.action.type === 'move') && task!.status === 'waiting')
  ) {
    task!.status = 'running';
    task!.reason = '等待下一次观察验证执行结果。';
    task!.waitFor = undefined;
  }
  if (!batch.ok && !['paused', 'cancelled'].includes(task!.status)) {
    task!.status = 'running';
    task!.reason = `批次中断：${batch.stopReason}，根据最新观察重新规划。`;
    task!.waitFor = undefined;
  }
  if (task!.status === 'completed' && memory.unfinishedBuild) {
    task!.status = 'blocked';
    task!.reason = '仍有未完成的建造方块，不能标记完成。';
  }
  if (task!.status === 'cancelled') memory.unfinishedBuild = undefined;
  const progress = JSON.stringify([
    finalObservation.self.x,
    finalObservation.self.y,
    finalObservation.self.z,
    worldSignature(finalObservation, 'world'),
  ]);
  const advanced = batch.results.some(
    (r) =>
      (r.action.type === 'edit' && r.result?.ok) ||
      (r.result && 'completed' in r.result && r.result.completed > 0) ||
      (r.before &&
        r.after &&
        Math.hypot(
          r.after.x - r.before.x,
          r.after.y - r.before.y,
          r.after.z - r.before.z,
        ) >= 0.05),
  );
  if (!quiet && batch.stopReason !== 'message') {
    memory.noProgress =
      !advanced && (!batch.ok || progress === memory.lastProgress)
        ? (memory.noProgress ?? 0) + 1
        : 0;
    memory.lastProgress = progress;
  }
  if (!quiet && (memory.noProgress ?? 0) >= 3 && task!.status === 'running') {
    task!.status = 'blocked';
    task!.reason = '连续三次失败或没有实际进展，已停止自动重试。';
  }
  if (task!.status === 'waiting')
    memory.waitSignature = worldSignature(finalObservation, task!.waitFor);
  if (addressed && !chats.length)
    await notifySender(
      batch.ok
        ? `收到。${task!.summary}`
        : '收到指令，但这次动作未成功，我会根据执行结果判断下一步。',
    );
  log(`批次 · 任务${task!.status}：${task!.reason || task!.summary}`);
}

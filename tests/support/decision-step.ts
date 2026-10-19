// Deterministic decision adapter for existing domain-policy fixtures. No production inference.
import type { Planner } from './decision-fixture';
import { agentPermissions } from '../../packages/shared/src/index';
import type { AgentTask, ChatData } from '../../packages/shared/src/index';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  AgentSession,
  Observation,
  AgentConfig,
  AgentAction,
} from '../../packages/agent-runtime/src/contracts';
import type { AgentAttention } from '../../packages/agent-runtime/src/runtime/attention';
import {
  newTask,
  type AgentRunState,
} from '../../packages/agent-runtime/src/task/state';
import { executeBatch } from '../../packages/agent-runtime/src/actions/batch';
import { parseDecision } from './decision-decision';
import { AgentRuntimeError } from '../../packages/agent-runtime/src/errors';
import {
  houseBlocks,
  observedEmpty,
} from '../../packages/agent-runtime/src/actions/building';
import { key } from '../../packages/shared/src/index';
import { RequestBudget } from '../../packages/agent-runtime/src/task/budget';

import {
  worldSignature,
  prepareDecision,
} from '../../packages/agent-runtime/src/task/observation';
import { cap } from '../../packages/agent-runtime/src/task/budget';
import { applyTaskDecision } from './decision-apply';
export { worldSignature } from '../../packages/agent-runtime/src/task/observation';
/** Empty polls and unchanged waits cost no tokens; planners count actual requests. */
export async function runTaskStep(
  session: Pick<AgentSession, 'observe' | 'move' | 'request'>,
  planner: Planner,
  config: AgentConfig,
  signal: AbortSignal,
  memory: AgentRunState,
  attention?: AgentAttention,
  log: (message: string) => void = () => {},
  checkpoint: () => any = () => {},
  hooks?: {
    beforeNewTask?: (task: AgentTask, previous: AgentRunState) => Promise<void>;
  },
) {
  const addressed = attention?.take();
  let task = memory.task;
  if (!addressed && !['running', 'waiting'].includes(task?.status ?? ''))
    return;
  if (!addressed && task) {
    const reason = cap(task, config);
    if (reason) {
      task.status = 'budget';
      task.reason = reason;
      log(reason);
      return;
    }
  }
  const prepared = await prepareDecision(session, memory, signal, addressed);
  if (!prepared) return;
  const { observation, context } = prepared;
  const started = Date.now();
  memory.usage ??= { calls: 0, tokens: 0, estimated: false };

  let chargedTask = !addressed ? task : undefined;
  const budget = new RequestBudget(config, memory.usage, chargedTask);
  const deadline = new AbortController();
  const decisionRemaining = chargedTask
    ? (config.taskTimeoutMs ?? 900000) - chargedTask.elapsedMs
    : (config.taskTimeoutMs ?? 900000);
  const decisionTimer = Number.isFinite(decisionRemaining)
    ? setTimeout(() => deadline.abort(), Math.max(1, decisionRemaining))
    : undefined;
  const decisionSignal = AbortSignal.any([signal, deadline.signal]);
  const notifySender = async (text: string) => {
    if (!addressed || signal.aborted || !agentPermissions(config).chat) return;
    try {
      const payload = {
        text: text.slice(0, 240),
        scope: 'private',
        recipients: [addressed.actor],
      };
      let result = await session.request('chat', payload);
      if (!result.ok && result.error === '发送过快，请稍候。') {
        await delay(350, undefined, { signal });
        result = await session.request('chat', payload);
      }
      if (!result.ok) log('消息处理回执未送达。');
    } catch {
      log('消息处理回执未送达。');
    }
  };
  let phase = '获取模型决策';
  try {
    if (!planner.managesRequests) budget.begin();
    const input = await planner.decide(
      observation,
      context,
      decisionSignal,
      budget,
    );
    await applyTaskDecision(
      session,
      input,
      prepared,
      config,
      decisionSignal,
      memory,
      budget,
      attention,
      log,
      checkpoint,
      hooks,
    );
    if (input.task.intent !== 'reply') chargedTask = memory.task;
  } catch (error) {
    if (signal.aborted) return;
    memory.failures = (memory.failures ?? 0) + 1;
    const reason =
      error instanceof AgentRuntimeError
        ? error.message
        : deadline.signal.aborted
          ? '本次任务决策超时，动作已停止。'
          : `${phase}时发生内部异常，已停止本次处理。`;
    memory.decisionError = reason;
    memory.lastResponse = reason;
    log(reason);
    await notifySender(`这条消息处理失败：${reason} 请稍后重试。`);
    if (task && !addressed) {
      if (
        (error instanceof AgentRuntimeError && error.fatal) ||
        memory.failures >= 3
      ) {
        task.status = 'blocked';
        task.reason = reason;
        throw new AgentRuntimeError('Agent 已停止自动执行：' + reason, true);
      }
    }
  } finally {
    clearTimeout(decisionTimer);
    if (!planner.managesRequests && budget.usage.calls)
      budget.finish(
        planner.lastUsage?.tokens ?? config.maxTokens,
        planner.lastUsage?.estimated ?? true,
      );
    budget.flushTime();
    if (chargedTask) {
      const reason = cap(chargedTask, config);
      if (reason && ['running', 'waiting'].includes(chargedTask.status)) {
        chargedTask.status = 'budget';
        chargedTask.reason = reason;
      }
    }
  }
}

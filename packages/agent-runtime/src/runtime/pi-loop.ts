import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import type { AgentConfig, ModelEndpoint } from '../contracts';
import { AgentRuntimeError } from '../errors';
import { piModel, piStream } from '../models/pi-provider';
import type { RequestBudget } from '../task/budget';
import { recentTurns } from '../pi/context';

import type { ToolState as LoopState } from '../pi/context';
export const loopState = (): LoopState => ({
  terminal: false,
  skipBatch: false,
  hadError: false,
  persistenceFailed: false,
  turnMutated: false,
});

/** Shared Pi mechanics only; conversation and task policies are injected separately. */
export async function runPiLoop(o: {
  config: AgentConfig;
  endpoint: ModelEndpoint;
  request: typeof fetch;
  budget: RequestBudget;
  signal: AbortSignal;
  state: LoopState;
  prompt: string;
  input: string;
  tools: AgentTool[];
  history?: Message[];
  save: () => Promise<void>;
  shouldYield: () => boolean;
  afterTurn?: () => void;
  transcript?: (messages: Message[]) => Promise<void>;
}) {
  const { state } = o;
  let correctedToolProtocol = false;
  let requestToolCorrection = false;
  const agent = new Agent({
    initialState: {
      model: piModel(o.config, o.endpoint),
      systemPrompt: o.prompt,
      tools: o.tools,
    },
    streamFn: piStream(
      o.config,
      o.endpoint,
      o.budget,
      o.signal,
      o.request,
      o.save,
    ),
    toolExecution: 'sequential',
    transformContext: async (messages) => {
      const retained = new Set(recentTurns(messages as Message[]));
      const input = messages.filter((m) => m.role === 'user').at(-1);
      const context = messages.filter(
        (m) => m.role === 'system' || m === input || retained.has(m as Message),
      );
      if (requestToolCorrection) {
        requestToolCorrection = false;
        context.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Protocol correction: ordinary assistant text is not delivered or executed. Respond using the provided native function tools. Do not repeat successful world actions. Use the prior tool results to choose the next required step; if they verify the entire task, call complete_task. For a conversation response, call reply.',
            },
          ],
          timestamp: Date.now(),
        });
      }
      return context;
    },
    beforeToolCall: async ({ assistantMessage }) => {
      if (assistantMessage.stopReason === 'length') {
        state.skipBatch = true;
        state.hadError = true;
        return { block: true, reason: '模型输出被截断，整批未执行。' };
      }
      if (
        state.terminal ||
        state.skipBatch ||
        state.persistenceFailed ||
        o.signal.aborted ||
        o.shouldYield()
      )
        return { block: true, reason: '当前批次已停止。', terminate: true };
      if (o.budget.remainingMs <= 0)
        return { block: true, reason: '执行时间预算已耗尽。', terminate: true };
      return undefined;
    },
    afterToolCall: async ({ isError }) => {
      if (isError) {
        state.hadError = true;
        state.skipBatch = true;
      }
      return undefined;
    },
    prepareRequest: async () => {
      state.turnMutated = false;
      state.skipBatch = false;
      state.hadError = false;
      await o.save();
    },
    finishTurn: async ({ message }) => {
      if (
        message.stopReason === 'stop' &&
        !message.content.some((p) => p.type === 'toolCall')
      ) {
        // One accounted correction for local models that answer in prose after
        // a tool result. Never parse prose as an action or replay a prior call.
        if (
          o.endpoint.type === 'ollama' &&
          !correctedToolProtocol &&
          !state.terminal &&
          !state.persistenceFailed &&
          !o.shouldYield() &&
          !o.signal.aborted
        ) {
          correctedToolProtocol = true;
          requestToolCorrection = true;
          return { action: 'continue' };
        }
        throw new AgentRuntimeError(
          '模型未返回工具调用；请使用支持原生工具调用的模型，本次运行已停止。',
        );
      }
      o.afterTurn?.();
      await o.transcript?.(agent.state.messages as Message[]);
      if (
        state.terminal ||
        state.persistenceFailed ||
        o.shouldYield() ||
        o.signal.aborted ||
        ['error', 'aborted'].includes(message.stopReason)
      )
        return { action: 'end' };
      return { action: 'continue' };
    },
  });
  agent.subscribe((event) => {
    if (event.type === 'tool_execution_end' && event.isError) {
      state.hadError = true;
      state.skipBatch = true;
    }
  });
  if (o.history?.length) agent.state.messages.push(...o.history);
  const abort = () => agent.abort();
  o.signal.addEventListener('abort', abort, { once: true });
  try {
    o.signal.throwIfAborted();
    await agent.prompt(o.input);
    if (agent.state.errorMessage && !o.signal.aborted)
      throw new AgentRuntimeError(agent.state.errorMessage);
    if (state.persistenceFailed)
      throw new AgentRuntimeError('无法保存任务检查点，已停止写操作。', true);
  } finally {
    o.signal.removeEventListener('abort', abort);
    o.budget.flushTime();
    if (!state.persistenceFailed)
      await o.transcript?.(agent.state.messages as Message[]);
  }
}

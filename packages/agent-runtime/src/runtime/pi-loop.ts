import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import {
  createInitialSystemMessage,
  type Message,
} from '@earendil-works/pi-ai';
import type { AgentConfig, ModelEndpoint } from '../contracts';
import { AgentRuntimeError } from '../errors';
import { piModel, piStream } from '../models/pi-provider';
import type { RequestBudget } from '../task/budget';
import { recentTurns, recentInteractions } from '../pi/context';

import type { ToolState as LoopState } from '../pi/context';
export const loopState = (): LoopState => ({
  terminal: false,
  skipBatch: false,
  hadError: false,
  persistenceFailed: false,
  turnMutated: false,
});

/** Pi session mechanics for the unified character event flow. */
type PiLoopOptions = {
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
  sessionKey?: object;
  interactionHistory?: boolean;
  contextEpoch?: () => string;
};
const sessions = new WeakMap<
  object,
  { agent: Agent; options: PiLoopOptions; reset: () => void }
>();
export async function runPiLoop(options: PiLoopOptions) {
  const cached = options.sessionKey
    ? sessions.get(options.sessionKey)
    : undefined;
  const o = cached?.options ?? options;
  if (cached) {
    for (const key of Object.keys(o))
      delete (o as unknown as Record<string, unknown>)[key];
    Object.assign(o, options);
    cached.reset();
  }
  let contextEpoch = o.contextEpoch?.();
  let correctedToolProtocol = false;
  let requestToolCorrection = false;
  const agent =
    cached?.agent ??
    new Agent({
      initialState: {
        model: piModel(o.config, o.endpoint),
        systemPrompt: o.prompt,
        tools: o.tools,
      },
      streamFn: (model, context, streamOptions) =>
        piStream(
          o.config,
          o.endpoint,
          o.budget,
          o.signal,
          o.request,
          o.save,
        )(model, context, streamOptions),
      toolExecution: 'sequential',
      transformContext: async (messages) => {
        if (contextEpoch !== o.contextEpoch?.()) {
          contextEpoch = o.contextEpoch?.();
          const lastInput = messages.map((m) => m.role).lastIndexOf('user');
          messages = messages.filter(
            (m, index) => m.role === 'system' || index >= lastInput,
          );
          agent.state.messages = messages;
        }
        const retained = new Set(
          (o.interactionHistory ? recentInteractions : recentTurns)(
            messages as Message[],
          ),
        );
        const input = messages.filter((m) => m.role === 'user').at(-1);
        const context = messages.filter(
          (m) =>
            m.role === 'system' || m === input || retained.has(m as Message),
        );
        if (requestToolCorrection) {
          requestToolCorrection = false;
          context.push({
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Protocol correction: your last answer was plain text and was NOT delivered or executed. Use the provided native function tools, never a bare JSON object or a .function prefix. This model requires the exact tool envelope: <tool_call>{"name":"FUNCTION_NAME","arguments":{}}</tool_call>. Replace FUNCTION_NAME and arguments with an available tool and valid values. Do not repeat successful world actions. If results verify the entire task, call complete_task. For a conversation response, call chat with your actual reply in the text argument.',
              },
            ],
            timestamp: Date.now(),
          });
        }
        return context;
      },
      beforeToolCall: async ({ assistantMessage }) => {
        if (assistantMessage.stopReason === 'length') {
          o.state.skipBatch = true;
          o.state.hadError = true;
          return { block: true, reason: '模型输出被截断，整批未执行。' };
        }
        if (
          o.state.terminal ||
          o.state.skipBatch ||
          o.state.persistenceFailed ||
          o.signal.aborted ||
          o.shouldYield()
        )
          return { block: true, reason: '当前批次已停止。', terminate: true };
        if (o.budget.remainingMs <= 0)
          return {
            block: true,
            reason: '执行时间预算已耗尽。',
            terminate: true,
          };
        return undefined;
      },
      afterToolCall: async ({ isError }) => {
        if (isError) {
          o.state.hadError = true;
          o.state.skipBatch = true;
        }
        return undefined;
      },
      prepareRequest: async () => {
        o.state.turnMutated = false;
        o.state.skipBatch = false;
        o.state.hadError = false;
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
            !o.state.terminal &&
            !o.state.persistenceFailed &&
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
          o.state.terminal ||
          o.state.persistenceFailed ||
          o.shouldYield() ||
          o.signal.aborted ||
          ['error', 'aborted'].includes(message.stopReason)
        )
          return { action: 'end' };
        return { action: 'continue' };
      },
    });
  if (!cached)
    agent.subscribe((event) => {
      if (event.type === 'tool_execution_end' && event.isError) {
        o.state.hadError = true;
        o.state.skipBatch = true;
      }
    });
  if (!cached && o.sessionKey)
    sessions.set(o.sessionKey, {
      agent,
      options: o,
      reset: () => {
        contextEpoch = o.contextEpoch?.();
        correctedToolProtocol = false;
        requestToolCorrection = false;
      },
    });
  agent.reset();
  agent.state.model = piModel(o.config, o.endpoint);
  agent.state.tools = o.tools;
  agent.state.messages = [
    createInitialSystemMessage(o.prompt, o.tools)!,
    ...(o.history ?? []),
  ];
  const abort = () => agent.abort();
  o.signal.addEventListener('abort', abort, { once: true });
  try {
    o.signal.throwIfAborted();
    await agent.prompt(o.input);
    if (agent.state.errorMessage && !o.signal.aborted)
      throw new AgentRuntimeError(agent.state.errorMessage);
    if (o.state.persistenceFailed)
      throw new AgentRuntimeError('无法保存任务检查点，已停止写操作。', true);
  } finally {
    o.signal.removeEventListener('abort', abort);
    o.budget.flushTime();
    if (!o.state.persistenceFailed)
      await o.transcript?.(agent.state.messages as Message[]);
  }
}

import { Agent } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import type { AgentTask } from '@voxel/shared';
import type {
  AgentConfig,
  AgentDecision,
  AgentSession,
  ModelEndpoint,
} from '../contracts';
import { AgentRuntimeError } from '../errors';
import { piModel, piStream, defaultEndpoint } from '../models/pi-provider';
import { RequestBudget, cap } from '../task/budget';
import { AgentAttention } from './attention';
import { applyTaskDecision } from './execute-step';
import { prepareDecision, worldSignature } from '../task/observation';
import type { AgentRunState } from '../task/state';
import { recentTurns, createPiTurnState } from '../pi/context';
import { restorePiCheckpoint, updatePiCheckpoint } from '../pi/checkpoint';
import { createPiTools } from '../pi/tools';
import { piInput, piPrompt } from '../pi/prompts';

export type RunOptions = {
  session: AgentSession;
  config: AgentConfig;
  signal: AbortSignal;
  memory: AgentRunState;
  attention?: AgentAttention;
  log?: (message: string) => void;
  checkpoint?: () => void | Promise<void>;
  hooks?: { beforeNewTask?: (task: AgentTask) => Promise<void> };
};
const running = new WeakSet<AgentRunState>();

/** Pi owns inference/tool continuation. The host owns wake-ups and durable world state. */
export class AgentRunner {
  constructor(
    private endpoint: ModelEndpoint = defaultEndpoint,
    private request: typeof fetch = fetch,
  ) {}
  async run(options: RunOptions): Promise<void> {
    const { memory } = options;
    if (running.has(memory))
      throw new AgentRuntimeError('Agent 已在运行。', true);
    running.add(memory);
    try {
      await this.runConversation(options);
    } finally {
      running.delete(memory);
    }
  }
  private async runConversation(options: RunOptions) {
    const { session, config, signal, memory, attention, hooks } = options;
    const log = options.log ?? (() => {});
    const addressed = attention?.take();
    if (
      !addressed &&
      !['running', 'waiting'].includes(memory.task?.status ?? '')
    )
      return;
    if (!addressed && memory.task) {
      const reason = cap(memory.task, config);
      if (reason) {
        memory.task.status = 'budget';
        memory.task.reason = reason;
        await options.checkpoint?.();
        return;
      }
    }
    signal.throwIfAborted();
    const prepared = await prepareDecision(session, memory, signal, addressed);
    if (!prepared) return;
    memory.usage ??= { calls: 0, tokens: 0, estimated: false };
    const budget = new RequestBudget(
      config,
      memory.usage,
      addressed ? undefined : memory.task,
    );
    const state = createPiTurnState(prepared, memory);
    // Finish the addressed reply before yielding; queued messages must not discard it.
    const shouldYield = () =>
      !!attention?.pending &&
      (state.mode !== 'reply' || !addressed || state.responseSent);
    const deadline = Number.isFinite(budget.remainingMs)
      ? AbortSignal.timeout(Math.max(1, budget.remainingMs))
      : new AbortController().signal;
    const activeSignal = AbortSignal.any([signal, deadline]);
    const save = async () => {
      if (state.persistenceFailed)
        throw new AgentRuntimeError('无法保存任务检查点，已停止写操作。', true);
      budget.flushTime();
      try {
        await options.checkpoint?.();
      } catch {
        state.persistenceFailed = true;
        state.terminal = true;
        throw new AgentRuntimeError('无法保存任务检查点，已停止写操作。', true);
      }
    };
    restorePiCheckpoint(memory);
    const history = !addressed && memory.pi ? memory.pi.messages : [];
    const savedTaskHistory = addressed ? (memory.pi?.messages ?? []) : [];
    const savedTaskStartedAt = memory.task?.startedAt;
    const unknownEffect =
      memory.pi?.inFlight?.state === 'unknown'
        ? memory.pi.inFlight.name
        : undefined;
    const initialProgress = () =>
      JSON.stringify([
        state.prepared.observation.revision,
        state.prepared.observation.self.x,
        state.prepared.observation.self.y,
        state.prepared.observation.self.z,
        worldSignature(state.prepared.observation, 'world'),
      ]);
    let progress = initialProgress();
    const persistTranscript = async () => {
      updatePiCheckpoint(memory, {
        mode: state.mode,
        messages: agent.state.messages as Message[],
        savedTaskHistory: state.restoredTaskHistory ? savedTaskHistory : [],
        apiKey: config.apiKey,
      });
      await save();
    };
    const apply = async (decision: AgentDecision) => {
      await applyTaskDecision(
        session,
        decision,
        state.prepared,
        config,
        activeSignal,
        memory,
        budget,
        attention,
        log,
        save,
        hooks && {
          beforeNewTask: async (task) => {
            try {
              await hooks.beforeNewTask?.(task);
            } catch {
              // The host may have rolled back its task book after a failed durable write.
              // Do not retry with the old budget reference or issue further effects.
              state.persistenceFailed = true;
              state.terminal = true;
              throw new AgentRuntimeError(
                '无法建立任务检查点，已停止本次运行。',
                true,
              );
            }
          },
        },
        true,
      );
      if (state.mode === 'task') {
        const next = await prepareDecision(session, memory, activeSignal);
        if (next) state.prepared = next;
      }
    };
    const tools = createPiTools({
      state,
      session,
      memory,
      addressed,
      activeSignal,
      history,
      unknownEffect,
      savedTaskStartedAt,
      shouldYield,
      save,
      apply,
    });
    const agent = new Agent({
      initialState: {
        model: piModel(config, this.endpoint),
        systemPrompt: piPrompt(config),
        tools,
      },
      streamFn: piStream(
        config,
        this.endpoint,
        budget,
        activeSignal,
        this.request,
        save,
      ),
      transformContext: async (messages) => {
        const complete = [
          ...(state.restoredTaskHistory ? savedTaskHistory : []),
          ...messages,
        ];
        const retained = new Set(recentTurns(complete as Message[]));
        const input = complete.filter((m) => m.role === 'user').at(-1);
        return complete.filter(
          (m) =>
            m.role === 'system' || m === input || retained.has(m as Message),
        );
      },
      toolExecution: 'sequential',
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
          activeSignal.aborted ||
          shouldYield()
        )
          return { block: true, reason: '当前批次已停止。', terminate: true };
        if (budget.remainingMs <= 0)
          return {
            block: true,
            reason: '任务时间预算已耗尽。',
            terminate: true,
          };
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
        state.turnAdvanced = false;
        await save();
      },
      finishTurn: async ({ message }) => {
        if (
          message.stopReason === 'stop' &&
          !message.content.some((part) => part.type === 'toolCall')
        ) {
          throw new AgentRuntimeError(
            '模型未返回工具调用；请使用支持原生工具调用的模型，本次运行已停止。',
          );
        }
        const nextProgress = initialProgress();
        if (!attention?.pending && state.mode === 'task') {
          memory.noProgress =
            !state.turnAdvanced && nextProgress === progress
              ? (memory.noProgress ?? 0) + 1
              : 0;
          progress = nextProgress;
          state.consecutiveFailures = state.hadError
            ? state.consecutiveFailures + 1
            : 0;
          memory.failures = state.consecutiveFailures;
          if (
            !state.terminal &&
            ((memory.noProgress ?? 0) >= 3 || (memory.failures ?? 0) >= 3)
          ) {
            memory.task!.status = 'blocked';
            memory.task!.reason =
              '连续三轮失败或没有实际进展，已停止自动重试。';
            state.terminal = true;
          }
        }
        await persistTranscript();
        if (
          state.terminal ||
          attention?.pending ||
          activeSignal.aborted ||
          ['error', 'aborted'].includes(message.stopReason)
        )
          return { action: 'end' };
        return { action: 'continue' };
      },
    });
    agent.subscribe((event) => {
      // Schema/unknown-tool failures happen before afterToolCall in Pi.
      if (event.type === 'tool_execution_end' && event.isError) {
        state.hadError = true;
        state.skipBatch = true;
      }
    });
    if (history.length)
      agent.state.messages = [...agent.state.messages, ...history];
    const abort = () => agent.abort();
    activeSignal.addEventListener('abort', abort, { once: true });
    try {
      activeSignal.throwIfAborted();
      await agent.prompt(
        piInput(
          config,
          state.prepared.observation,
          state.prepared.context,
          state.mode === 'task' ? memory : undefined,
        ),
      );
      if (agent.state.errorMessage && !signal.aborted)
        throw new AgentRuntimeError(agent.state.errorMessage);
      if ((state.mode as string) === 'reply' && !state.responseSent)
        log('本次对话未发送聊天消息。');
    } catch (error) {
      if (!signal.aborted) {
        const reason = state.persistenceFailed
          ? '无法保存任务检查点，已停止写操作。'
          : deadline.aborted
            ? '任务执行时间预算已耗尽。'
            : error instanceof AgentRuntimeError
              ? error.message
              : 'Agent 执行异常，已停止本次运行。';
        memory.lastResponse = reason;
        log(reason);
        if (state.mode === 'task' && memory.task) {
          memory.task.status =
            cap(memory.task, config) || deadline.aborted ? 'budget' : 'blocked';
          memory.task.reason = reason;
        }
        if (state.persistenceFailed) throw new AgentRuntimeError(reason, true);
      }
    } finally {
      activeSignal.removeEventListener('abort', abort);
      budget.flushTime();
      if (!state.persistenceFailed) await persistTranscript();
    }
  }
}

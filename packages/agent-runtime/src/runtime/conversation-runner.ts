import { paceChat } from './chat-pacing';
import { cancellable } from '../client/cancellable';
import {
  aiCharacterPermissions,
  type WorldEvent,
  type ChatData,
} from '@voxel/shared';
import type { ModelEndpoint } from '../contracts';
import { AgentRuntimeError } from '../errors';
import { RequestBudget } from '../task/budget';
import { TaskService } from '../task/service';
import { worldView, conversationPrompt } from '../pi/prompts';
import { conversationTools } from '../pi/conversation-tools';
import { loopState, runPiLoop } from './pi-loop';
import type { RunOptions } from './options';

export class ConversationRunner {
  constructor(
    private endpoint: ModelEndpoint,
    private request: typeof fetch,
  ) {}
  async run(o: RunOptions, message: WorldEvent) {
    const { memory, signal } = o;
    const key = `${o.attention?.generation ?? 'standalone'}:${message.actor}:${message.seq}`;
    if (memory.conversation?.key === key) return;
    const state = loopState();
    const bounded = (value: number | undefined, fallback: number) =>
      Number.isFinite(value) && value! > 0
        ? Math.min(value!, fallback)
        : fallback;
    const config = {
      ...o.config,
      maxTurns: bounded(o.config.maxTurns, 12),
      tokenBudget: bounded(o.config.tokenBudget, 50000),
      taskTimeoutMs: bounded(o.config.taskTimeoutMs, 60000),
    };
    memory.usage ??= { calls: 0, tokens: 0, estimated: false };
    const budget = new RequestBudget(config, memory.usage);
    const deadline = AbortSignal.timeout(config.taskTimeoutMs);
    const active = AbortSignal.any([signal, deadline]);
    const service = new TaskService(memory);
    const save = async () => {
      budget.flushTime();
      if (state.persistenceFailed)
        throw new AgentRuntimeError('无法保存消息检查点，已停止。', true);
      try {
        await o.checkpoint?.();
      } catch {
        state.persistenceFailed = true;
        state.terminal = true;
        throw new AgentRuntimeError('无法保存任务检查点，已停止写操作。', true);
      }
    };
    const send = async (text: string) => {
      active.throwIfAborted();
      memory.lastResponse = text;
      if (!aiCharacterPermissions(config).chat) {
        o.log?.(text);
        await save();
        return;
      }
      await paceChat(memory, active);
      memory.conversation = { key, state: 'reply_unknown' };
      await save();
      active.throwIfAborted();
      const privateReply = ['private', 'nearby'].includes(
        (message.data as ChatData).scope,
      );
      const result = await cancellable(
        o.session.request('chat', {
          text,
          scope: privateReply ? 'private' : 'public',
          recipients: privateReply ? [message.actor] : [],
        }),
        active,
      );
      active.throwIfAborted();
      if (!result.ok)
        throw new AgentRuntimeError('回复未送达，本次不自动重发。');
      memory.conversation = { key, state: 'done' };
      await save();
    };
    const tools = conversationTools(
      async (text) => {
        state.terminal = true;
        await send(text);
      },
      async (command, text) => {
        active.throwIfAborted();
        try {
          await service.commit(
            command,
            { kind: 'player', message },
            o.config,
            async () => {
              memory.conversation = { key, state: 'accepted' };
              await save();
            },
            budget,
            o.hooks?.beforeNewTask,
          );
        } catch (error) {
          if (error instanceof AgentRuntimeError && error.fatal) {
            state.persistenceFailed = true;
            state.terminal = true;
          }
          throw error;
        }
        state.terminal = true;
        if (text) await send(text);
      },
    );
    try {
      active.throwIfAborted();
      const raw = await cancellable(o.session.observe(), active);
      active.throwIfAborted();
      const privateTo =
        (message.data as ChatData).scope !== 'public'
          ? message.actor
          : undefined;
      const task = memory.task;
      const visible = task && (!task.privateTo || task.privateTo === privateTo);
      await runPiLoop({
        config,
        endpoint: this.endpoint,
        request: this.request,
        budget,
        signal: active,
        state,
        prompt: conversationPrompt(config),
        tools,
        save,
        shouldYield: () => false,
        input: JSON.stringify({
          currentRequest: {
            actor: message.actor,
            text: (message.data as ChatData).text,
          },
          character: {
            roleDescription: config.roleDescription ?? '',
            skills: config.skills ?? [],
          },
          observation: worldView({
            ...raw,
            // Conversation only routes messages to task commands; terrain is
            // observed by the task executor. Sending it here can crowd the
            // system prompt and tool definitions out of a local model's context.
            blocks: [],
            events: [message],
            attention: message,
          }),
          task:
            visible && !['completed', 'cancelled'].includes(task.status)
              ? {
                  goal: task.goal,
                  status: task.status,
                  summary: task.summary,
                  owner: task.owner,
                }
              : undefined,
        }),
      });
    } catch (error) {
      if (!signal.aborted) {
        memory.lastResponse =
          error instanceof AgentRuntimeError
            ? error.message
            : '消息处理失败，请稍后重试。';
        o.log?.(memory.lastResponse);
      }
      if (state.persistenceFailed)
        throw new AgentRuntimeError('无法保存任务检查点，已停止写操作。', true);
    } finally {
      budget.flushTime();
      if (!state.persistenceFailed) await save();
    }
  }
}

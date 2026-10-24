import type { Message } from '@earendil-works/pi-ai';
import {
  aiCharacterPermissions,
  type ChatData,
  type WorldEvent,
} from '@voxel/shared';
import { runDecisionLoop } from './decide';
import { buildDecisionPayload } from './input';
import { paceChat } from '../action/reply';
import { runFollowStep } from '../action/follow';
import type { RunOptions } from './options';
import { createTaskControlTools } from '../tools/conversation';
import type { TurnContext } from './turn';
import { TurnHealthMonitor } from './health';
import { createRuntimeWorldTools } from '../tools/world';
import { BackgroundActionTracker } from '../action/background';
import { AgentRuntimeError } from '../../contracts/errors';
import { prepareDecision } from './prepare';
import { worldSignature } from '../../world/observe/extract';
import { cancellable } from '../../kernel/abort';
import { RequestBudget, checkBudgetCap } from '../task/budget';
import { recordEvent } from '../task/inbox';
import { TaskService } from '../task/service';
import type { ModelEndpoint } from '../../contracts';
import {
  checkpointMessages,
  restoreCheckpoint,
  updateCheckpoint,
} from './checkpoint';
import { initialToolState, recentInteractions, recentTurns } from './window';
import { characterPrompt } from '../prompt/system';

/** One decision flow for addressed messages, plan instructions and action results. */
export class CharacterRunner {
  constructor(
    private endpoint: ModelEndpoint,
    private request: typeof fetch,
  ) {}

  async run(o: RunOptions) {
    const { memory, signal } = o;
    const background = new BackgroundActionTracker();
    let message = o.attention?.take();
    if (!message) restoreCheckpoint(memory);
    if (
      memory.task.current &&
      ['running', 'waiting'].includes(memory.task.current.status)
    ) {
      const reason = checkBudgetCap(memory.task.current, o.config);
      if (reason) {
        memory.task.current.status = 'budget';
        memory.task.current.reason = reason;
        await o.checkpoint?.();
      }
    }
    let actionResult = false;
    try {
      do {
        if (signal.aborted) break;
        if (
          !message &&
          memory.effects.follow &&
          !actionResult &&
          memory.task.current &&
          ['running', 'waiting'].includes(memory.task.current.status)
        ) {
          const reason = checkBudgetCap(memory.task.current!, o.config);
          if (reason) {
            memory.task.current!.status = 'budget';
            memory.task.current!.reason = reason;
            await o.checkpoint?.();
          } else await runFollowStep(o);
          if (
            memory.task.current?.status === 'blocked' &&
            memory.effects.activeAction?.status === 'failed'
          ) {
            delete memory.effects.follow;
            memory.task.current.status = 'running';
            actionResult = true;
          } else return;
        }
        if (
          !message &&
          !actionResult &&
          (!memory.task.current ||
            !['running', 'waiting'].includes(memory.task.current.status))
        )
          return;
        if (!background.isRunning || message || actionResult) {
          await this.decide(
            o,
            message,
            background.isRunning,
            () => background.stop(),
            (id, ctrl, work) => background.launch(id, ctrl, work),
          );
          actionResult = false;
        }
        message = o.attention?.take();
        if (message) continue;
        if (background.isRunning) {
          await background.wait(o.attention, signal);
          message = o.attention?.take();
          if (!message && background.isSettled) {
            await background.complete();
            actionResult = true;
          }
          continue;
        }
        if (
          message === undefined &&
          memory.task.current?.status === 'running'
        ) {
          actionResult = true;
          continue;
        }
        return;
      } while (!signal.aborted);
    } finally {
      await background.cleanup();
    }
  }

  private async decide(
    o: RunOptions,
    message: WorldEvent | undefined,
    actionRunning: boolean,
    stopAction: () => Promise<void>,
    launch: (
      id: string,
      controller: AbortController,
      work: Promise<void>,
    ) => void,
  ) {
    const { memory, signal } = o;
    const service = new TaskService(memory);
    let expected = memory.task.current ? service.lease() : undefined;
    const current = () => !expected || service.current(expected);
    const scope =
      message && (message.data as ChatData).scope !== 'public'
        ? message.actor
        : message
          ? 'public'
          : (memory.task.current?.privateTo ?? 'public');
    const event = message
      ? recordEvent(memory, {
          id: `chat:${o.attention?.generation ?? 'standalone'}:${message.actor}:${message.seq}`,
          kind: 'chat',
          state: 'pending',
          at: Date.now(),
          audience: scope,
          actor: message.actor,
          message,
        })
      : memory.inbox?.events.find(
          (e) =>
            e.state === 'pending' &&
            e.kind !== 'chat' &&
            (e.kind !== 'plan' || e.taskId === expected?.id),
        );
    if (event && ['done', 'unknown'].includes(event.state)) return;
    if (
      event?.taskId &&
      (!expected ||
        event.taskId !== expected.id ||
        event.revision !== expected.revision)
    ) {
      event.state = 'unknown';
      await o.checkpoint?.();
      return;
    }
    if (event) event.state = 'processing';
    const state = initialToolState();
    const defaults = o.defaults ?? o.config;
    const config = { ...(message ? defaults : o.config) };
    if (message) {
      if (!Number.isFinite(config.maxTurns)) config.maxTurns = 100;
      if (!Number.isFinite(config.tokenBudget)) config.tokenBudget = 50000;
      if (!Number.isFinite(config.taskTimeoutMs)) config.taskTimeoutMs = 900000;
    }
    memory.task.usage ??= { calls: 0, tokens: 0, estimated: false };
    const budget = new RequestBudget(
      config,
      memory.task.usage,
      message ? undefined : memory.task.current,
    );
    const active = signal;
    let attached = !message;
    let launched = false;
    const save = async () => {
      budget.flushTime();
      if (state.persistenceFailed)
        throw new AgentRuntimeError('无法保存事件检查点，已停止。', true);
      try {
        await o.checkpoint?.();
      } catch {
        state.persistenceFailed = true;
        state.terminal = true;
        throw new AgentRuntimeError('无法保存事件检查点，已停止写操作。', true);
      }
    };
    const authorize = () => {
      if (expected) service.assertCurrent(expected);
      if (message) service.authorize({ kind: 'player', message });
    };
    const attach = () => {
      if (attached) return;
      authorize();
      if (
        !memory.task.current ||
        !['running', 'waiting'].includes(memory.task.current.status)
      )
        throw new AgentRuntimeError('当前任务未运行，请先恢复或创建任务。');
      Object.assign(config, o.config);
      budget.attach(memory.task.current);
      attached = true;
    };
    const send = async (text: string) => {
      memory.health.lastResponse = text;
      if (!aiCharacterPermissions(config).chat) {
        o.log?.(text);
        await save();
        return;
      }
      await paceChat(memory, active);
      if (event) event.state = 'unknown';
      await save();
      const response = await cancellable(
        o.session.request('chat', {
          text,
          scope: scope === 'public' ? 'public' : 'private',
          recipients: scope === 'public' ? [] : [scope],
        }),
        active,
      );
      if (!response.ok)
        throw new AgentRuntimeError('回复未送达，本次不自动重发。');
      if (event) event.state = 'processing';
      await save();
    };
    try {
      if (!message) {
        const reason = checkBudgetCap(memory.task.current!, config);
        if (reason) throw new AgentRuntimeError(reason);
      }
      let prepared = await prepareDecision(o.session, memory, active, message);
      if (!prepared) return;
      memory.health.lastProgress ??=
        worldSignature(prepared.observation, 'world') +
        JSON.stringify(prepared.observation.self);
      const observe = async () => {
        const next = await prepareDecision(o.session, memory, active, message);
        if (next) prepared = next;
      };

      const turnCtx: TurnContext = {
        session: o.session,
        service,
        budget,
        state,
        activeSignal: active,
        memory,
        config,
        userConfig: o.config,
        defaults,
        message,
        attention: o.attention,
        log: o.log,
        prepared: () => prepared!,
        observe,
        save,
        attach,
        authorize,
        send,
        actionRunning: () => actionRunning,
        isLaunched: () => launched,
        onLaunched: () => {
          launched = true;
        },
        launch,
        stopAction,
        onActionStopped: () => {
          actionRunning = false;
          launched = false;
        },
        onTaskCommitted: (lease) => {
          expected = lease;
          attached = true;
        },
        beforeNewTaskHook: o.hooks?.beforeNewTask,
      };

      const controlTools = createTaskControlTools(turnCtx);
      const worldTools = createRuntimeWorldTools(turnCtx);

      const healthMonitor = new TurnHealthMonitor();
      const history = message
        ? (memory.conversation.exchanges?.[scope] as Message[] | undefined)
        : checkpointMessages(memory);

      await runDecisionLoop({
        config,
        endpoint: this.endpoint,
        request: this.request,
        budget,
        signal: active,
        state,
        sessionKey: o.session,
        interactionHistory: !!message,
        prompt: characterPrompt(config),
        tools: [...controlTools, ...worldTools],
        history,
        input: buildDecisionPayload({
          config,
          message,
          prepared: prepared!,
          memory,
          event,
        }),
        save,
        shouldYield: () => !current() || (!message && !!o.attention?.pending),
        contextEpoch: () =>
          `${memory.task.identity?.id}:${memory.task.identity?.revision}`,
        afterTurn: () =>
          healthMonitor.recordTurn({
            maxStalledTurns: config.maxStalledTurns,
            state,
            attached,
            current,
            memory,
            service,
            hasMessage: !!message,
            launched,
            observation: prepared!.observation,
          }),
        transcript: async (messages) => {
          const clean = JSON.parse(
            JSON.stringify(
              (message ? recentInteractions : recentTurns)(messages),
            )
              .split(config.apiKey || '\u0000')
              .join('[已隐藏]'),
          );
          if (message) {
            memory.conversation.exchanges ??= {};
            delete memory.conversation.exchanges[scope];
            memory.conversation.exchanges[scope] = clean;
            const keys = Object.keys(memory.conversation.exchanges).filter(
              (key) => key !== 'public',
            );
            for (const key of keys.slice(0, -16))
              delete memory.conversation.exchanges[key];
          }
          if (attached && memory.task.current)
            updateCheckpoint(memory, clean, config.apiKey);
          await save();
        },
      });
      if (event && event.state !== 'unknown') event.state = 'done';
    } catch (error) {
      if (!signal.aborted) {
        const reason =
          error instanceof Error ? error.message : '角色事件处理失败。';
        memory.health.lastResponse = reason;
        o.log?.(reason);
        if (
          attached &&
          current() &&
          memory.task.current &&
          !['completed', 'cancelled'].includes(memory.task.current.status)
        ) {
          memory.task.current.status =
            checkBudgetCap(memory.task.current, config) || active.aborted
              ? 'budget'
              : 'blocked';
          memory.task.current.reason = reason;
        }
      }
      if (event && event.state !== 'done') event.state = 'unknown';
      if (state.persistenceFailed) throw error;
    } finally {
      if (!state.persistenceFailed) await save();
    }
  }
}

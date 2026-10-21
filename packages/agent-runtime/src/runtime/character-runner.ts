import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import {
  aiCharacterPermissions,
  type ChatData,
  type WorldEvent,
} from '@voxel/shared';
import type { ModelEndpoint } from '../contracts';
import { AgentRuntimeError } from '../errors';
import { RequestBudget, cap } from '../task/budget';
import { TaskService, type TaskCommand } from '../task/service';
import { prepareDecision, worldSignature } from '../task/observation';
import {
  checkpointMessages,
  restorePiCheckpoint,
  updatePiCheckpoint,
} from '../pi/checkpoint';
import { recentTurns, recentInteractions } from '../pi/context';
import { createTaskTools } from '../pi/tools';
import { conversationToolSchemas, toolSchemas } from '../pi/tool-schemas';
import { piInput, piPrompt } from '../pi/prompts';
import { executeTaskActions } from './action-executor';
import { loopState, runPiLoop } from './pi-loop';
import { runFollowStep } from './follow-step';
import { paceChat } from './chat-pacing';
import { cancellable } from '../client/cancellable';
import { recordEvent } from './event-inbox';
import type { RunOptions } from './options';

const result = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  details: {},
});

/** One decision flow for addressed messages, plan instructions and action results. */
export class CharacterRunner {
  constructor(
    private endpoint: ModelEndpoint,
    private request: typeof fetch,
  ) {}
  async run(o: RunOptions) {
    const { memory, signal } = o;
    let action:
      | {
          id: string;
          controller: AbortController;
          done: Promise<void>;
          settled: boolean;
        }
      | undefined;
    let message = o.attention?.take();
    if (!message) restorePiCheckpoint(memory);
    if (memory.task && ['running', 'waiting'].includes(memory.task.status)) {
      const reason = cap(memory.task, o.config);
      if (reason) {
        memory.task.status = 'budget';
        memory.task.reason = reason;
        await o.checkpoint?.();
      }
    }
    let actionResult = false;
    try {
      do {
        if (signal.aborted) break;
        if (
          !message &&
          memory.follow &&
          !actionResult &&
          memory.task &&
          ['running', 'waiting'].includes(memory.task.status)
        ) {
          const reason = cap(memory.task!, o.config);
          if (reason) {
            memory.task!.status = 'budget';
            memory.task!.reason = reason;
            await o.checkpoint?.();
          } else await runFollowStep(o);
          if (
            memory.task?.status === 'blocked' &&
            memory.activeAction?.status === 'failed'
          ) {
            delete memory.follow;
            memory.task.status = 'running';
            actionResult = true;
          } else return;
        }
        if (
          !message &&
          !actionResult &&
          (!memory.task || !['running', 'waiting'].includes(memory.task.status))
        )
          return;
        if (!action || message || actionResult) {
          await this.decide(
            o,
            message,
            !!action,
            async () => {
              if (action) {
                action.controller.abort();
                await action.done;
                action = undefined;
              }
            },
            (id, controller, work) => {
              const current = {
                id,
                controller,
                settled: false,
                done: Promise.resolve(),
              };
              current.done = work.finally(() => {
                current.settled = true;
              });
              action = current;
            },
          );
          actionResult = false;
        }
        message = o.attention?.take();
        if (message) continue;
        if (action) {
          if (!action.settled) {
            if (o.attention)
              await Promise.race([
                action.done,
                o.attention.wait(60000, signal),
              ]);
            else await action.done;
          }
          message = o.attention?.take();
          if (!message && action.settled) {
            await action.done;
            action = undefined;
            actionResult = true;
          }
          continue;
        }
        if (message === undefined && memory.task?.status === 'running') {
          actionResult = true;
          continue;
        }
        return;
      } while (!signal.aborted);
    } finally {
      if (action) {
        action.controller.abort();
        await action.done;
      }
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
    let expected = memory.task ? service.lease() : undefined;
    const current = () => !expected || service.current(expected);
    const scope =
      message && (message.data as ChatData).scope !== 'public'
        ? message.actor
        : message
          ? 'public'
          : (memory.task?.privateTo ?? 'public');
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
    const state = loopState();
    const defaults = o.defaults ?? o.config;
    const config = { ...(message ? defaults : o.config) };
    if (message) {
      if (!Number.isFinite(config.maxTurns)) config.maxTurns = 100;
      if (!Number.isFinite(config.tokenBudget)) config.tokenBudget = 50000;
      if (!Number.isFinite(config.taskTimeoutMs)) config.taskTimeoutMs = 900000;
    }
    memory.usage ??= { calls: 0, tokens: 0, estimated: false };
    const budget = new RequestBudget(
      config,
      memory.usage,
      message ? undefined : memory.task,
    );
    const active = signal;
    let attached = !message;
    let launched = false;
    let eventFailures = 0;
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
      if (!memory.task || !['running', 'waiting'].includes(memory.task.status))
        throw new AgentRuntimeError('当前任务未运行，请先恢复或创建任务。');
      Object.assign(config, o.config);
      budget.attach(memory.task);
      attached = true;
    };
    const send = async (text: string) => {
      memory.lastResponse = text;
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
        const reason = cap(memory.task!, config);
        if (reason) throw new AgentRuntimeError(reason);
      }
      let prepared = await prepareDecision(o.session, memory, active, message);
      if (!prepared) return;
      memory.lastProgress ??=
        worldSignature(prepared.observation, 'world') +
        JSON.stringify(prepared.observation.self);
      const observe = async () => {
        const next = await prepareDecision(o.session, memory, active, message);
        if (next) prepared = next;
      };
      const controlTools: AgentTool[] = Object.entries(
        conversationToolSchemas,
      ).map(([name, parameters]) => ({
        name,
        label: name,
        parameters,
        description:
          name === 'reply'
            ? 'Reply to the current human message without changing the activity.'
            : 'Control the current activity, preserving its identity and spent budget. After start or revise, use world tools in this same session.',
        execute: async (_id, value) => {
          const args = value as {
            text?: string;
            goal?: string;
            reply?: string;
            relatedToTask?: boolean;
          };
          if (name === 'reply') {
            if (
              args.relatedToTask &&
              memory.task &&
              ['running', 'waiting'].includes(memory.task.status) &&
              !cap(memory.task, o.config)
            )
              attach();
            await send(args.text!);
            state.terminal = true;
            return result({ replied: true });
          }
          if (!message)
            throw new AgentRuntimeError('任务控制需要明确玩家指令。');
          authorize();
          await stopAction();
          actionRunning = false;
          launched = false;
          budget.flushTime();
          const command = {
            type: name.replace('_task', ''),
            goal: args.goal,
          } as TaskCommand;
          // Switching tasks within one event must never reset already charged usage.
          if (command.type === 'start') Object.assign(config, defaults);
          else Object.assign(config, o.config);
          try {
            await service.commit(
              command,
              { kind: 'player', message },
              config,
              save,
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
          expected = service.lease();
          attached = true;
          if (command.type === 'start') Object.assign(o.config, config);
          if (['pause'].includes(command.type)) state.terminal = true;
          await observe();
          if (args.reply) await send(args.reply);
          return result({ task: memory.task });
        },
      }));
      const worldTools: AgentTool[] = Object.entries(toolSchemas).map(
        ([name, parameters]) => ({
          name,
          label: name,
          parameters,
          description: ['goto', 'build', 'house'].includes(name)
            ? `Start ${name}; returns an action ID. Completion arrives as an action_result event. Never start a second action while one runs.`
            : `Use ${name} for the current authorized activity. If no task exists, first call start_task(goal); a world tool never creates a task implicitly.`,
          execute: async (id, value, ...rest) => {
            if (name === 'chat' && message) {
              const args = value as { text: string; relatedToTask?: boolean };
              if (
                args.relatedToTask &&
                memory.task &&
                ['running', 'waiting'].includes(memory.task.status) &&
                !cap(memory.task, o.config)
              )
                attach();
              await send(args.text);
              state.terminal = true;
              return result({ replied: true });
            }
            if (name === 'observe') {
              await observe();
              return result({
                observation: prepared!.observation,
                activity: prepared!.context,
              });
            }
            authorize();
            if (actionRunning || launched)
              throw new AgentRuntimeError(
                '当前动作尚未结束，请读取进度或先明确停止。',
              );
            if (
              !memory.task ||
              !['running', 'waiting'].includes(memory.task.status)
            )
              throw new AgentRuntimeError(
                'No active running task. For a NEW human action request, call start_task(goal) FIRST, then retry the world tool. Do not claim completion: no world action was executed. A paused or exhausted task must be resumed, never recreated.',
              );
            attach();
            const lease = service.lease();
            const background = ['goto', 'build', 'house'].includes(name);
            const controller = new AbortController();
            const toolSignal = AbortSignal.any([active, controller.signal]);
            const toolState = background ? loopState() : state;
            const taskTools = createTaskTools({
              state: toolState,
              memory,
              service,
              lease,
              prepared: () => prepared!,
              observe,
              canChat: aiCharacterPermissions(config).chat,
              signal: toolSignal,
              save,
              shouldYield: () => !background && !!o.attention?.pending,
              execute: async (action) => {
                const outcome = await executeTaskActions(
                  o.session,
                  [action],
                  prepared!.observation,
                  config,
                  toolSignal,
                  memory,
                  budget,
                  lease,
                  save,
                  background ? undefined : o.attention,
                  o.log,
                );
                prepared!.observation = {
                  ...outcome.observation,
                  attention: message,
                };
                await observe();
                return outcome.batch;
              },
            });
            const tool = taskTools.find((t) => t.name === name)!;
            if (!background) {
              const valueResult = await tool.execute(id, value, ...rest);
              if (name === 'follow' && memory.follow)
                memory.activeAction = {
                  id,
                  name,
                  taskId: lease.id,
                  revision: lease.revision,
                  status: 'running',
                };
              return valueResult;
            }
            memory.activeAction = {
              id,
              name,
              taskId: lease.id,
              revision: lease.revision,
              status: 'running',
            };
            await save();
            const work = Promise.resolve(tool.execute(id, value, ...rest))
              .then(
                (value) => {
                  if (service.current(lease))
                    memory.activeAction = {
                      id,
                      name,
                      taskId: lease.id,
                      revision: lease.revision,
                      status: 'completed',
                      result: value,
                    };
                },
                (error) => {
                  if (service.current(lease))
                    memory.activeAction = {
                      id,
                      name,
                      taskId: lease.id,
                      revision: lease.revision,
                      status: signal.aborted ? 'unknown' : 'failed',
                      result: String(error),
                    };
                },
              )
              .then(async () => {
                if (service.current(lease))
                  recordEvent(memory, {
                    id: `action:${id}`,
                    kind: 'action_result',
                    state: 'pending',
                    at: Date.now(),
                    audience: memory.task?.privateTo ?? 'public',
                    taskId: lease.id,
                    revision: lease.revision,
                    actionId: id,
                  });
                await save();
              });
            launch(id, controller, work);
            launched = true;
            state.terminal = true;
            return result({ actionId: id, status: 'running' });
          },
        }),
      );
      const visible = prepared.context.task;
      const history = message
        ? (memory.exchanges?.[scope] as Message[] | undefined)
        : checkpointMessages(memory);
      await runPiLoop({
        config,
        endpoint: this.endpoint,
        request: this.request,
        budget,
        signal: active,
        state,
        sessionKey: o.session,
        interactionHistory: !!message,
        prompt: piPrompt(config),
        tools: [...controlTools, ...worldTools],
        history,
        input: JSON.stringify({
          ...JSON.parse(
            piInput(
              config,
              message
                ? { ...prepared.observation, blocks: [] }
                : prepared.observation,
              message
                ? {
                    task:
                      visible &&
                      !['completed', 'cancelled'].includes(visible.status)
                        ? {
                            goal: visible.goal,
                            status: visible.status,
                            summary: visible.summary,
                            calls: visible.calls,
                            tokens: visible.tokens,
                          }
                        : undefined,
                  }
                : prepared.context,
              visible ? memory : undefined,
            ),
          ),
          activityState: visible?.status ?? 'none',
          nextStep:
            (!visible || ['completed', 'cancelled'].includes(visible.status)) &&
            message
              ? 'No activity exists. To perform requested world actions, first call start_task(goal), then the world tool. For questions use the native chat tool.'
              : undefined,
          currentRequest: message
            ? { actor: message.actor, text: (message.data as ChatData).text }
            : undefined,
          event: event
            ? { kind: event.kind, id: event.id, detail: event.detail }
            : { kind: 'condition_changed' },
          activeAction: visible ? memory.activeAction : undefined,
        }),
        save,
        shouldYield: () => !current() || (!message && !!o.attention?.pending),
        contextEpoch: () =>
          `${memory.identity?.id}:${memory.identity?.revision}`,
        afterTurn: () => {
          eventFailures = state.hadError ? eventFailures + 1 : 0;
          if (eventFailures >= 3) {
            if (attached) memory.failures = eventFailures;
            state.terminal = true;
            memory.lastResponse = '连续三轮工具失败，已停止本次事件。';
            if (
              attached &&
              current() &&
              memory.task &&
              !['completed', 'cancelled'].includes(memory.task.status)
            )
              service.finish(service.lease(), {
                status: 'blocked',
                reason: memory.lastResponse,
              });
            return;
          }
          if (message || launched || state.terminal) return;
          memory.failures = state.hadError ? (memory.failures ?? 0) + 1 : 0;
          const signature =
            worldSignature(prepared!.observation, 'world') +
            JSON.stringify(prepared!.observation.self);
          memory.noProgress =
            signature === memory.lastProgress
              ? (memory.noProgress ?? 0) + 1
              : 0;
          memory.lastProgress = signature;
          if (memory.failures >= 3 || memory.noProgress >= 3) {
            service.finish(service.lease(), {
              status: 'blocked',
              reason: '连续三轮失败或没有实际进展，已停止自动重试。',
            });
            state.terminal = true;
          }
        },
        transcript: async (messages) => {
          const clean = JSON.parse(
            JSON.stringify(
              (message ? recentInteractions : recentTurns)(messages),
            )
              .split(config.apiKey || '\u0000')
              .join('[已隐藏]'),
          );
          if (message) {
            memory.exchanges ??= {};
            delete memory.exchanges[scope];
            memory.exchanges[scope] = clean;
            const keys = Object.keys(memory.exchanges).filter(
              (key) => key !== 'public',
            );
            for (const key of keys.slice(0, -16)) delete memory.exchanges[key];
          }
          if (attached && memory.task)
            updatePiCheckpoint(memory, clean, config.apiKey);
          await save();
        },
      });
      if (event && event.state !== 'unknown') event.state = 'done';
    } catch (error) {
      if (!signal.aborted) {
        const reason =
          error instanceof Error ? error.message : '角色事件处理失败。';
        memory.lastResponse = reason;
        o.log?.(reason);
        if (
          attached &&
          current() &&
          memory.task &&
          !['completed', 'cancelled'].includes(memory.task.status)
        ) {
          memory.task.status =
            cap(memory.task, config) || active.aborted ? 'budget' : 'blocked';
          memory.task.reason = reason;
        }
      }
      if (event && event.state !== 'done') event.state = 'unknown';
      if (state.persistenceFailed) throw error;
    } finally {
      if (!state.persistenceFailed) await save();
    }
  }
}

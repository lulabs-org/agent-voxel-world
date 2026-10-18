import { setTimeout as delay } from 'node:timers/promises';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import type { AgentTask } from '@voxel/shared';
import type {
  AgentConfig,
  AgentDecision,
  AgentSession,
  ModelEndpoint,
  TaskDirective,
} from '../contracts';
import { AgentRuntimeError } from '../errors';
import { houseBlocks, observedEmpty } from '../actions/building';
import { piModel, piStream, defaultEndpoint } from './pi-provider';
import { RequestBudget } from './budget';
import { AgentAttention } from './attention';
import {
  applyTaskDecision,
  prepareDecision,
  worldSignature,
  cap,
} from './task-policy';
import { parseTaskDirective, type AgentRunState } from './task';
import { recentTurns, restorePiCheckpoint } from './pi-context';
import { toolSchemas } from './tool-schemas';
import { piInput, piPrompt, worldView } from './pi-prompts';

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
    let prepared = await prepareDecision(session, memory, signal, addressed);
    if (!prepared) return;
    memory.usage ??= { calls: 0, tokens: 0, estimated: false };
    const budget = new RequestBudget(
      config,
      memory.usage,
      addressed ? undefined : memory.task,
    );
    let mode: 'reply' | 'task' | undefined = addressed ? 'reply' : 'task';
    let terminal = false,
      skipBatch = false,
      persistenceFailed = false,
      responseSent = false;
    let turnMutated = false,
      hadError = false,
      turnAdvanced = false;
    let lastChat = 0;
    let consecutiveFailures = memory.failures ?? 0;
    // Finish the addressed reply before yielding; queued messages must not discard it.
    const shouldYield = () =>
      !!attention?.pending && (mode !== 'reply' || !addressed || responseSent);
    let directive: TaskDirective = {
      intent: addressed ? 'reply' : 'continue',
      status: 'running',
      summary: memory.task?.summary || '执行任务',
    };
    const deadline = Number.isFinite(budget.remainingMs)
      ? AbortSignal.timeout(Math.max(1, budget.remainingMs))
      : new AbortController().signal;
    const activeSignal = AbortSignal.any([signal, deadline]);
    const save = async () => {
      if (persistenceFailed)
        throw new AgentRuntimeError('无法保存任务检查点，已停止写操作。', true);
      budget.flushTime();
      try {
        await options.checkpoint?.();
      } catch {
        persistenceFailed = true;
        terminal = true;
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
    let restoredTaskHistory = false;
    const initialProgress = () =>
      JSON.stringify([
        prepared!.observation.revision,
        prepared!.observation.self.x,
        prepared!.observation.self.y,
        prepared!.observation.self.z,
        worldSignature(prepared!.observation, 'world'),
      ]);
    let progress = initialProgress();
    const persistTranscript = async () => {
      if (
        mode === 'task' &&
        memory.task &&
        !['completed', 'cancelled'].includes(memory.task.status)
      ) {
        memory.pi = {
          version: 1,
          taskStartedAt: memory.task.startedAt,
          audience: memory.task.privateTo ?? 'public',
          messages: recentTurns([
            ...(restoredTaskHistory ? savedTaskHistory : []),
            ...agent.state.messages,
          ] as Message[]),
          inFlight: memory.pi?.inFlight,
        };
        if (config.apiKey)
          memory.pi = JSON.parse(
            JSON.stringify(memory.pi).split(config.apiKey).join('[已隐藏]'),
          );
      } else if (
        memory.task &&
        ['completed', 'cancelled'].includes(memory.task.status)
      )
        delete memory.pi;
      await save();
    };
    const result = (value: unknown) => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(value, (key, value) =>
            key === 'batchId' ? undefined : value,
          ),
        },
      ],
      details: {},
    });
    const apply = async (decision: AgentDecision) => {
      await applyTaskDecision(
        session,
        decision,
        prepared!,
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
              persistenceFailed = true;
              terminal = true;
              throw new AgentRuntimeError(
                '无法建立任务检查点，已停止本次运行。',
                true,
              );
            }
          },
        },
        true,
      );
      if (mode === 'task') {
        const next = await prepareDecision(session, memory, activeSignal);
        if (next) prepared = next;
      }
    };
    const tools: AgentTool[] = Object.entries(toolSchemas).map(
      ([name, parameters]) => ({
        name,
        label: name,
        parameters,
        description:
          name === 'update_task'
            ? 'Choose message intent before actions; update task status and finish only after verified results.'
            : name === 'observe'
              ? 'Observe visible world and confirmed/unfinished task progress.'
              : `Execute ${name} in the world.`,
        execute: async (id, value) => {
          const args = value as Record<string, any>;
          activeSignal.throwIfAborted();
          if (terminal || skipBatch || shouldYield())
            throw new AgentRuntimeError(
              '本批已停止，请根据新消息或执行结果重新判断。',
            );
          if (
            !addressed &&
            unknownEffect === name &&
            ['chat', 'move'].includes(name)
          )
            throw new AgentRuntimeError(
              '上次聊天或移动结果未知，不能自动重放；请等待玩家确认或明确的新指令。',
            );
          if (mode === 'task' && memory.task) {
            memory.pi ??= {
              version: 1,
              taskStartedAt: memory.task.startedAt,
              audience: memory.task.privateTo ?? 'public',
              messages: history,
            };
            memory.pi.inFlight = { id, name, state: 'executing' };
          }
          await save();
          try {
            if (name === 'observe') {
              const fresh = await session.observe();
              activeSignal.throwIfAborted();
              prepared!.observation = {
                ...fresh,
                events: prepared!.observation.events,
                attention: prepared!.observation.attention,
              };
              // Reconcile partially built coordinates without introducing historical chats.
              const reconciled = await prepareDecision(
                { observe: async () => prepared!.observation },
                memory,
                activeSignal,
                prepared!.addressed,
              );
              if (reconciled) prepared = reconciled;
              return result({
                observation: worldView(prepared!.observation),
                unfinishedBuild:
                  mode === 'task' ? memory.unfinishedBuild : undefined,
              });
            }
            if (name === 'update_task') {
              const next = parseTaskDirective(args);
              if (!addressed && next.intent !== 'continue')
                throw new AgentRuntimeError('自动推进只能继续当前任务。');
              if (mode === 'task' && addressed && next.intent === 'task')
                throw new AgentRuntimeError(
                  '当前任务已建立，请继续；不能重复创建任务重置预算。',
                );
              if (
                next.status === 'completed' &&
                next.intent !== 'reply' &&
                (turnMutated ||
                  memory.pendingEffects ||
                  memory.unfinishedBuild ||
                  (memory.previous &&
                    !(memory.previous as { ok?: boolean }).ok))
              )
                throw new AgentRuntimeError(
                  '当前仍有未确认或失败动作，先读取结果或重新观察，再确认完成。',
                );
              if (
                next.intent === 'task' &&
                memory.task &&
                !['completed', 'cancelled'].includes(memory.task.status)
              )
                throw new AgentRuntimeError(
                  '已有未结束任务；修改当前任务请使用 update，不能重建任务重置额度。',
                );
              const proposedMode = next.intent === 'reply' ? 'reply' : 'task';
              // An initial control call decides ownership before any effect.
              const previousMode = mode;
              mode = proposedMode;
              try {
                await apply({ actions: [{ type: 'wait' }], task: next });
              } catch (error) {
                mode = previousMode;
                throw error;
              }
              if (
                mode === 'task' &&
                addressed &&
                !restoredTaskHistory &&
                memory.task?.startedAt === savedTaskStartedAt
              ) {
                restoredTaskHistory = true;
              }
              if (['task', 'update', 'resume'].includes(next.intent)) {
                memory.noProgress = 0;
                memory.failures = 0;
                consecutiveFailures = 0;
                turnAdvanced = true;
              }
              directive = {
                ...next,
                intent: mode === 'reply' ? 'reply' : 'continue',
                status: 'running',
              };
              terminal =
                mode === 'reply'
                  ? next.status !== 'running'
                  : !['running'].includes(memory.task?.status ?? '');
              if (terminal && mode === 'reply')
                memory.lastResponse ||= next.summary;
              return result({
                status: mode === 'task' ? memory.task?.status : next.status,
                summary: next.summary,
              });
            }
            if (!mode)
              throw new AgentRuntimeError(
                '先用 update_task 确认这条消息是回复、任务还是任务控制。',
              );
            if (name === 'wait') {
              if (mode !== 'task')
                throw new AgentRuntimeError(
                  '对话回复请使用 update_task 结束，不创建等待任务。',
                );
              await apply({
                actions: [{ type: 'wait' }],
                task: {
                  ...directive,
                  status: 'waiting',
                  waitFor: args.waitFor,
                  summary: args.summary,
                },
              });
              terminal = true;
              return result({ status: 'waiting' });
            }
            if (name === 'chat' && lastChat)
              await delay(
                Math.max(0, 350 - (Date.now() - lastChat)),
                undefined,
                { signal: activeSignal },
              );
            await apply({
              actions: [
                { ...args, type: name } as AgentDecision['actions'][number],
              ],
              task: { ...directive, status: 'running' },
            });
            const batch =
              mode === 'reply'
                ? memory.lastReply
                : (memory.previous as import('../contracts').BatchResult);
            if (!batch?.ok) {
              if (
                batch &&
                mode === 'task' &&
                ['move', 'edit', 'build', 'house'].includes(name)
              )
                memory.pendingEffects = batch;
              skipBatch = true;
              throw new AgentRuntimeError(
                JSON.stringify(batch ?? { error: '动作未执行' }),
              );
            }
            if (name === 'chat') {
              lastChat = Date.now();
              responseSent = true;
              memory.lastResponse = args.text;
              if (mode === 'reply') terminal = true;
            }
            if (['move', 'edit', 'build', 'house'].includes(name))
              turnMutated = true;
            const action = {
              ...args,
              type: name,
            } as AgentDecision['actions'][number];
            const edits =
              action.type === 'edit'
                ? [action]
                : action.type === 'build'
                  ? action.blocks
                  : action.type === 'house'
                    ? houseBlocks(action)
                    : [];
            const unconfirmed = edits.filter((edit) =>
              edit.material === null
                ? !observedEmpty(prepared!.observation, edit)
                : !prepared!.observation.blocks.some(
                    (block) =>
                      block.x === edit.x &&
                      block.y === edit.y &&
                      block.z === edit.z &&
                      block.material === edit.material,
                  ),
            );
            return result({
              batch,
              ...(edits.length
                ? {
                    verification: {
                      requested: edits.length,
                      observedMatching: edits.length - unconfirmed.length,
                      unconfirmed,
                    },
                  }
                : {}),
              position: prepared!.observation.self,
              revision: prepared!.observation.revision,
              unfinishedBuild:
                mode === 'task' ? memory.unfinishedBuild : undefined,
            });
          } finally {
            if (
              memory.pi?.inFlight?.id === id &&
              !persistenceFailed &&
              !activeSignal.aborted &&
              (memory.previous as { stopReason?: string })?.stopReason !==
                'unknown'
            )
              delete memory.pi.inFlight;
            await save();
          }
        },
      }),
    );
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
          ...(restoredTaskHistory ? savedTaskHistory : []),
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
          skipBatch = true;
          hadError = true;
          return { block: true, reason: '模型输出被截断，整批未执行。' };
        }
        if (
          terminal ||
          skipBatch ||
          persistenceFailed ||
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
          hadError = true;
          skipBatch = true;
        }
        return undefined;
      },
      prepareRequest: async () => {
        turnMutated = false;
        skipBatch = false;
        hadError = false;
        turnAdvanced = false;
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
        if (!attention?.pending && mode === 'task') {
          memory.noProgress =
            !turnAdvanced && nextProgress === progress
              ? (memory.noProgress ?? 0) + 1
              : 0;
          progress = nextProgress;
          consecutiveFailures = hadError ? consecutiveFailures + 1 : 0;
          memory.failures = consecutiveFailures;
          if (
            !terminal &&
            ((memory.noProgress ?? 0) >= 3 || (memory.failures ?? 0) >= 3)
          ) {
            memory.task!.status = 'blocked';
            memory.task!.reason =
              '连续三轮失败或没有实际进展，已停止自动重试。';
            terminal = true;
          }
        }
        await persistTranscript();
        if (
          terminal ||
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
        hadError = true;
        skipBatch = true;
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
          prepared.observation,
          prepared.context,
          mode === 'task' ? memory : undefined,
        ),
      );
      if (agent.state.errorMessage && !signal.aborted)
        throw new AgentRuntimeError(agent.state.errorMessage);
      if ((mode as string) === 'reply' && !responseSent)
        log('本次对话未发送聊天消息。');
    } catch (error) {
      if (!signal.aborted) {
        const reason = persistenceFailed
          ? '无法保存任务检查点，已停止写操作。'
          : deadline.aborted
            ? '任务执行时间预算已耗尽。'
            : error instanceof AgentRuntimeError
              ? error.message
              : 'Agent 执行异常，已停止本次运行。';
        memory.lastResponse = reason;
        log(reason);
        if (mode === 'task' && memory.task) {
          memory.task.status =
            cap(memory.task, config) || deadline.aborted ? 'budget' : 'blocked';
          memory.task.reason = reason;
        }
        if (persistenceFailed) throw new AgentRuntimeError(reason, true);
      }
    } finally {
      activeSignal.removeEventListener('abort', abort);
      budget.flushTime();
      if (!persistenceFailed) await persistTranscript();
    }
  }
}

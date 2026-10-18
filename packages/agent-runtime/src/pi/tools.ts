import { setTimeout as delay } from 'node:timers/promises';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import type { WorldEvent } from '@voxel/shared';
import type { AgentDecision, AgentSession } from '../contracts';
import { AgentRuntimeError } from '../errors';
import { houseBlocks, observedEmpty } from '../actions/building';
import type { AgentRunState } from '../task/state';
import { prepareDecision } from '../task/observation';
import { parseTaskDirective } from '../task/directive';
import { validateToolDirective } from '../task/transitions';
import type { PiTurnState } from './context';
import { toolSchemas } from './tool-schemas';
import { worldView } from './prompts';

/** Adapt sequential Pi tools to the host's validated world/task executor. */
export function createPiTools({
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
}: {
  state: PiTurnState;
  session: AgentSession;
  memory: AgentRunState;
  addressed?: WorldEvent;
  activeSignal: AbortSignal;
  history: Message[];
  unknownEffect?: string;
  savedTaskStartedAt?: number;
  shouldYield: () => boolean;
  save: () => Promise<void>;
  apply: (decision: AgentDecision) => Promise<void>;
}): AgentTool[] {
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
  return Object.entries(toolSchemas).map(([name, parameters]) => ({
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
      if (state.terminal || state.skipBatch || shouldYield())
        throw new AgentRuntimeError(
          '本批已停止，请根据新消息或执行结果重新判断。',
        );
      if (
        !addressed &&
        unknownEffect === name &&
        ['chat', 'move', 'goto', 'follow'].includes(name)
      )
        throw new AgentRuntimeError(
          '上次聊天或移动结果未知，不能自动重放；请等待玩家确认或明确的新指令。',
        );
      if (state.mode === 'task' && memory.task) {
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
          state.prepared.observation = {
            ...fresh,
            events: state.prepared.observation.events,
            attention: state.prepared.observation.attention,
          };
          // Reconcile partially built coordinates without introducing historical chats.
          const reconciled = await prepareDecision(
            { observe: async () => state.prepared.observation },
            memory,
            activeSignal,
            state.prepared.addressed,
          );
          if (reconciled) state.prepared = reconciled;
          return result({
            observation: worldView(state.prepared.observation),
            unfinishedBuild:
              state.mode === 'task' ? memory.unfinishedBuild : undefined,
          });
        }
        if (name === 'update_task') {
          const next = parseTaskDirective(args);
          validateToolDirective(next, memory, {
            addressed: !!addressed,
            taskMode: state.mode === 'task',
            turnMutated: state.turnMutated,
          });
          const proposedMode = next.intent === 'reply' ? 'reply' : 'task';
          // An initial control call decides ownership before any effect.
          const previousMode = state.mode;
          state.mode = proposedMode;
          try {
            await apply({ actions: [{ type: 'wait' }], task: next });
          } catch (error) {
            state.mode = previousMode;
            throw error;
          }
          if (
            state.mode === 'task' &&
            addressed &&
            !state.restoredTaskHistory &&
            memory.task?.startedAt === savedTaskStartedAt
          ) {
            state.restoredTaskHistory = true;
          }
          if (['task', 'update', 'resume'].includes(next.intent)) {
            memory.noProgress = 0;
            memory.failures = 0;
            state.consecutiveFailures = 0;
            state.turnAdvanced = true;
          }
          state.directive = {
            ...next,
            intent: state.mode === 'reply' ? 'reply' : 'continue',
            status: 'running',
          };
          state.terminal =
            state.mode === 'reply'
              ? next.status !== 'running'
              : !['running'].includes(memory.task?.status ?? '');
          if (state.terminal && state.mode === 'reply')
            memory.lastResponse ||= next.summary;
          return result({
            status: state.mode === 'task' ? memory.task?.status : next.status,
            summary: next.summary,
          });
        }
        if (!state.mode)
          throw new AgentRuntimeError(
            '本次动作未执行。先用 update_task 明确消息意图：要求移动或建造时用 task（已有未结束任务用 update），然后执行对应工具；问候或问题才用 reply。不能只口头答应执行。',
          );
        if (name === 'wait') {
          if (state.mode !== 'task')
            throw new AgentRuntimeError(
              '对话回复请使用 update_task 结束，不创建等待任务。',
            );
          await apply({
            actions: [{ type: 'wait' }],
            task: {
              ...state.directive,
              status: 'waiting',
              waitFor: args.waitFor,
              summary: args.summary,
            },
          });
          state.terminal = true;
          return result({ status: 'waiting' });
        }
        if (name === 'chat' && state.lastChat)
          await delay(
            Math.max(0, 350 - (Date.now() - state.lastChat)),
            undefined,
            { signal: activeSignal },
          );
        await apply({
          actions: [
            { ...args, type: name } as AgentDecision['actions'][number],
          ],
          task: { ...state.directive, status: 'running' },
        });
        const batch =
          state.mode === 'reply'
            ? memory.lastReply
            : (memory.previous as import('../contracts').BatchResult);
        if (!batch?.ok) {
          if (
            batch &&
            state.mode === 'task' &&
            ['move', 'goto', 'follow', 'edit', 'build', 'house'].includes(name)
          )
            memory.pendingEffects = batch;
          state.skipBatch = true;
          throw new AgentRuntimeError(
            JSON.stringify(batch ?? { error: '动作未执行' }),
          );
        }
        if (name === 'follow' && memory.follow) state.terminal = true;
        if (name === 'chat') {
          state.lastChat = Date.now();
          state.responseSent = true;
          memory.lastResponse = args.text;
          if (state.mode === 'reply') state.terminal = true;
        }
        if (['move', 'goto', 'follow', 'edit', 'build', 'house'].includes(name))
          state.turnMutated = true;
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
            ? !observedEmpty(state.prepared.observation, edit)
            : !state.prepared.observation.blocks.some(
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
          position: state.prepared.observation.self,
          revision: state.prepared.observation.revision,
          unfinishedBuild:
            state.mode === 'task' ? memory.unfinishedBuild : undefined,
        });
      } finally {
        if (
          memory.pi?.inFlight?.id === id &&
          !state.persistenceFailed &&
          !activeSignal.aborted &&
          (memory.previous as { stopReason?: string })?.stopReason !== 'unknown'
        )
          delete memory.pi.inFlight;
        await save();
      }
    },
  }));
}

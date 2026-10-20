import { aiCharacterPermissions } from '@voxel/shared';
import type { ModelEndpoint } from '../contracts';
import { AgentRuntimeError } from '../errors';
import { RequestBudget, cap } from '../task/budget';
import { TaskService } from '../task/service';
import { prepareDecision, worldSignature } from '../task/observation';
import {
  checkpointMessages,
  restorePiCheckpoint,
  updatePiCheckpoint,
} from '../pi/checkpoint';
import { createTaskTools } from '../pi/tools';
import { piInput, piPrompt } from '../pi/prompts';
import { executeTaskActions } from './action-executor';
import { loopState, runPiLoop } from './pi-loop';
import type { RunOptions } from './options';

export class TaskRunner {
  constructor(
    private endpoint: ModelEndpoint,
    private request: typeof fetch,
  ) {}
  async run(o: RunOptions) {
    const { memory, config, signal, session, attention } = o;
    if (!memory.task || !['running', 'waiting'].includes(memory.task.status))
      return;
    restorePiCheckpoint(memory);
    const service = new TaskService(memory);
    const lease = service.lease();
    const state = loopState();
    memory.usage ??= { calls: 0, tokens: 0, estimated: false };
    const budget = new RequestBudget(config, memory.usage, memory.task);
    const deadline = Number.isFinite(budget.remainingMs)
      ? AbortSignal.timeout(Math.max(1, budget.remainingMs))
      : new AbortController().signal;
    const active = AbortSignal.any([signal, deadline]);
    const save = async () => {
      service.assertCurrent(lease);
      budget.flushTime();
      if (state.persistenceFailed)
        throw new AgentRuntimeError('无法保存任务检查点，已停止写操作。', true);
      try {
        await o.checkpoint?.();
      } catch {
        state.persistenceFailed = true;
        state.terminal = true;
        throw new AgentRuntimeError('无法保存任务检查点，已停止写操作。', true);
      }
    };
    try {
      const reason = cap(memory.task, config);
      if (reason) {
        memory.task.status = 'budget';
        memory.task.reason = reason;
        await save();
        return;
      }
      const initial = await prepareDecision(session, memory, active);
      if (!initial) return;
      let prepared = initial;
      const observe = async () => {
        const next = await prepareDecision(session, memory, active);
        service.assertCurrent(lease);
        if (next) prepared = next;
      };
      const tools = createTaskTools({
        state,
        memory,
        service,
        lease,
        prepared: () => prepared,
        observe,
        canChat: aiCharacterPermissions(config).chat,
        signal: active,
        save,
        shouldYield: () => !!attention?.pending,
        execute: async (action) => {
          const outcome = await executeTaskActions(
            session,
            [action],
            prepared.observation,
            config,
            active,
            memory,
            budget,
            lease,
            save,
            attention,
            o.log,
          );
          prepared.observation = {
            ...outcome.observation,
            attention: undefined,
            events: [],
          };
          await observe();
          return outcome.batch;
        },
      });
      const signature = () =>
        JSON.stringify([
          prepared.observation.revision,
          prepared.observation.self.x,
          prepared.observation.self.y,
          prepared.observation.self.z,
          worldSignature(prepared.observation, 'world'),
        ]);
      let progress = signature();
      await runPiLoop({
        config,
        endpoint: this.endpoint,
        request: this.request,
        budget,
        signal: active,
        state,
        prompt: piPrompt(config),
        input: piInput(config, prepared.observation, prepared.context, memory),
        tools,
        history: checkpointMessages(memory),
        save,
        shouldYield: () => !!attention?.pending || !service.current(lease),
        afterTurn: () => {
          if (!service.current(lease) || attention?.pending || state.terminal)
            return;
          const next = signature();
          memory.noProgress =
            next === progress ? (memory.noProgress ?? 0) + 1 : 0;
          progress = next;
          memory.failures = state.hadError ? (memory.failures ?? 0) + 1 : 0;
          if (memory.noProgress >= 3 || memory.failures >= 3) {
            service.finish(lease, {
              status: 'blocked',
              reason: '连续三轮失败或没有实际进展，已停止自动重试。',
            });
            state.terminal = true;
          }
        },
        transcript: async (messages) => {
          if (!service.current(lease)) return;
          updatePiCheckpoint(memory, messages, config.apiKey);
          await save();
        },
      });
      if (deadline.aborted && !signal.aborted)
        throw new AgentRuntimeError('任务执行时间预算已耗尽。');
    } catch (error) {
      if (service.current(lease) && !signal.aborted) {
        const reason =
          error instanceof AgentRuntimeError
            ? error.message
            : 'Agent 执行异常，已停止本次运行。';
        memory.lastResponse = reason;
        o.log?.(reason);
        memory.task!.status =
          cap(memory.task!, config) || deadline.aborted ? 'budget' : 'blocked';
        memory.task!.reason = reason;
      }
      if (state.persistenceFailed)
        throw new AgentRuntimeError('无法保存任务检查点，已停止写操作。', true);
    } finally {
      budget.flushTime();
      if (!state.persistenceFailed && service.current(lease)) await save();
    }
  }
}

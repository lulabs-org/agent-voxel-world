import {
  agentPermissions,
  hasPlanTokenLimit,
  executionLimits,
  DEFAULT_TASK_LIMITS,
  type ManagedAgentView,
  type ChatData,
} from '@voxel/shared';
import {
  AgentAttention,
  AgentRuntimeError,
  type AgentConfig,
  type AgentRunner,
  type Session,
} from '@voxel/agent-runtime';
import { appendAgentLog } from './agent-logs';
import { newPlan, newRun } from './scheduler';
import type { VoiceServiceStore } from '../audio/tts/voice-services';
import type { SavedProvider } from './validation';
import type { Job } from './types';
import { captureTask, currentRun } from './task-operations';

export type ExecutionContext = {
  serverUrl: string;
  dependencies: {
    session: (url: string) => Session;
    runner: (
      config: AgentConfig,
      provider: SavedProvider,
    ) => Pick<AgentRunner, 'run'>;
  };
  voiceServices?: VoiceServiceStore;
  closing: () => boolean;
  bindVoice: (job: Job) => void;
  controlTask: (id: string, op: 'pause' | 'cancel') => Promise<unknown>;
  wake: (job: Job) => void;
  schedule: (job: Job) => void;
  save: () => Promise<void>;
  persist: () => void;
};

export async function executeAgentJob(
  job: Job,
  provider: SavedProvider,
  run = true,
  ctx: ExecutionContext,
): Promise<void> {
  const log = (message: string) => {
    const safe = provider.apiKey
      ? message.split(provider.apiKey).join('[已隐藏]')
      : message;
    appendAgentLog(job.view, safe);
    const record = currentRun(job);
    if (record) record.logs = [...record.logs, safe].slice(-40);
    ctx.persist();
  };

  let finalStatus: ManagedAgentView['status'] = 'idle';

  try {
    captureTask(job);
    await ctx.save();
    if (job.abort.signal.aborted || ctx.closing()) return;

    const record = currentRun(job);
    const plan = job.book.plans.find((p) => p.id === record?.planId);
    const limits = record?.snapshot.limits;
    const config: AgentConfig = {
      ...job.view,
      ...provider.inference,
      ...(limits ? executionLimits(limits) : {}),
      ...(record && plan && hasPlanTokenLimit(record.snapshot)
        ? {
            tokenBudget: Math.min(
              executionLimits(limits!).tokenBudget,
              (job.memory.task?.tokens ?? 0) +
                Math.max(0, plan.totalTokenBudget - plan.spentTokens),
            ),
          }
        : {}),
      apiKey: provider.apiKey,
    };

    if (!job.session) {
      const session = ctx.dependencies.session(ctx.serverUrl);
      job.attention = new AgentAttention();
      job.session = session;
      await session.join(job.view.name, 'ai-agent');
      job.view.sessionId = session.room.sessionId;

      session.onEvent = (event) => {
        if (
          ctx.closing() ||
          job.controlling ||
          job.session !== session ||
          !['running', 'idle', 'failed'].includes(job.view.status)
        )
          return;
        if (!job.attention.push(event, session.room.sessionId)) return;

        const command = (event.data as ChatData).text
          .trim()
          .replace(/^@[^\n]+?\s+(?=(?:暂停|停止|取消|别建))/u, '')
          .replace(/[！!。.?？\s]+$/u, '');
        const task = job.memory.task;

        if (
          task &&
          (!task.owner || task.owner === event.actor) &&
          (!task.privateTo ||
            (task.privateTo === event.actor &&
              (event.data as ChatData).scope !== 'public')) &&
          /^(暂停|暂停任务|停止|停止任务|别建了|取消|取消任务)$/u.test(command)
        ) {
          void ctx
            .controlTask(
              job.view.id,
              command.startsWith('取消') ? 'cancel' : 'pause',
            )
            .then(() =>
              agentPermissions(job.view).chat
                ? session.request('chat', {
                    text: command.startsWith('取消')
                      ? '任务已取消，我会留在这里待命。'
                      : '任务已暂停，进度已保留。',
                    scope: 'private',
                    recipients: [event.actor],
                  })
                : undefined,
            )
            .catch(() => {});
          return;
        }

        if (['idle', 'failed'].includes(job.view.status)) {
          log('收到玩家消息，处理一次唤醒。');
          ctx.wake(job);
        }
      };

      session.room.onMessage(
        'agent.speech.error',
        (value: { message: string }) => log(`语音：${value.message}`),
      );

      session.room.onLeave(() => {
        ctx.voiceServices?.unbind(session.room.sessionId);
        if (job.session !== session) return;
        job.session = undefined;
        delete job.view.sessionId;
        job.abort.abort();
        if (job.view.status !== 'stopping') {
          job.view.status = 'failed';
          log('世界连接已断开，可点击继续运行重新加入。');
        }
        ctx.persist();
      });

      log('已加入世界。');
    }

    const voiceResult = await job.session.request('agent.voice', {
      enabled: !!job.view.voiceReplies && agentPermissions(job.view).chat,
    });
    ctx.bindVoice(job);
    if (!voiceResult.ok) log('语音回复开关未生效，请检查服务器版本。');

    if (!job.abort.signal.aborted && run) {
      job.view.status = 'running';
      if (!job.memory.follow || job.attention.pending)
        log(job.attention.pending ? '处理当前消息。' : '启动 Pi 任务执行。');

      await ctx.dependencies.runner(config, provider).run({
        session: job.session,
        config,
        signal: job.abort.signal,
        memory: job.memory,
        attention: job.attention,
        log,
        checkpoint: async () => {
          await ctx.save();
        },
        hooks: {
          beforeNewTask: async (task) => {
            captureTask(job);
            const previous = currentRun(job);
            if (previous && ['running', 'waiting'].includes(previous.status))
              throw new AgentRuntimeError(
                '角色已有正在执行的任务，请先暂停或结束。',
              );
            const beforeBook = structuredClone(job.book),
              beforeMemory = structuredClone(job.memory);
            try {
              const plan = newPlan(
                {
                  name: task.goal.slice(0, 80),
                  goal: task.goal,
                  timing: { kind: 'immediate' },
                  timeZone: 'UTC',
                  limits: { ...DEFAULT_TASK_LIMITS },
                  totalTokenBudget: 500000,
                },
                task.startedAt,
              );
              const record = newRun(plan, task.startedAt, 'chat');
              record.task = task;
              job.book.plans.push(plan);
              job.book.runs.push(record);
              job.book.currentRunId = record.id;
              for (const key of Object.keys(job.memory))
                if (key !== 'usage')
                  delete (job.memory as Record<string, unknown>)[key];
              job.memory.task = task;
              Object.assign(config, plan.limits);
              await ctx.save();
            } catch (error) {
              job.book = beforeBook;
              for (const key of Object.keys(job.memory))
                delete (job.memory as Record<string, unknown>)[key];
              Object.assign(job.memory, beforeMemory);
              throw error;
            }
          },
        },
      });
    }

    finalStatus =
      job.abort.signal.aborted && !job.controlling ? 'failed' : 'idle';
    if (finalStatus === 'idle' && !job.memory.follow)
      log(
        run
          ? '本次唤醒结束，按任务状态安排下一次检查。'
          : '已在世界中待命；可通过私聊或 @ 交流，也可以安排新任务。',
      );
  } catch (error) {
    finalStatus = 'failed';
    if (!job.abort.signal.aborted)
      log(
        error instanceof AgentRuntimeError
          ? error.message
          : '无法加入世界或执行动作，请检查世界连接和模型配置。',
      );
  } finally {
    if (!job.view.sessionId) {
      await job.session
        ?.close()
        .catch(() => job.session?.room?.connection.close());
      job.session = undefined;
    }
    if (job.view.status !== 'stopping') job.view.status = finalStatus;
    ctx.persist();
    ctx.schedule(job);
  }
}

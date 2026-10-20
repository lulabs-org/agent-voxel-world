import {
  aiCharacterPermissions,
  type AICharacterView,
  type ChatData,
  type WorldEvent,
} from '@voxel/shared';
import {
  AgentAttention,
  AgentRuntimeError,
  TaskService,
  type AgentConfig,
  type AgentRunner,
  type Session,
} from '@voxel/agent-runtime';
import type { TaskLease } from '@voxel/agent-runtime';
import { appendAICharacterLog } from './logs';

import type { VoiceServicePort as VoiceServiceStore } from './ports';
import type { SavedProvider } from '../providers/provider-validation';
import type { Job } from './types';
import {
  captureTask,
  currentRun,
  executionConfigOverrides,
  beginChatExecution,
} from '../tasks/execution';
import { executionState } from './execution-adapter';

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
  controlMessage: (
    id: string,
    op: 'pause' | 'cancel',
    identity: TaskLease,
    commandId: string,
    message: WorldEvent,
  ) => Promise<unknown>;
  wake: (job: Job) => void;
  schedule: (job: Job) => void;
  save: () => Promise<void>;
  persist: () => void;
};

/** One host owns the world connection and one runtime execution slot for its Agent. */
export class AICharacterHost {
  constructor(
    private job: Job,
    private ctx: ExecutionContext,
  ) {}
  async run(provider: SavedProvider, run = true): Promise<void> {
    const { job, ctx } = this;
    const log = (message: string) => {
      const safe = provider.apiKey
        ? message.split(provider.apiKey).join('[已隐藏]')
        : message;
      appendAICharacterLog(job.view, safe);
      const record = currentRun(executionState(job));
      if (record) record.logs = [...record.logs, safe].slice(-40);
      ctx.persist();
    };

    let finalStatus: AICharacterView['status'] = 'idle';

    try {
      captureTask(executionState(job));
      await ctx.save();
      if (job.abort.signal.aborted || ctx.closing()) return;

      const config: AgentConfig = {
        ...job.view,
        ...provider.inference,
        ...executionConfigOverrides(executionState(job)),
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
          if (!job.attention.accept(event, session.room.sessionId)) return;

          const command = (event.data as ChatData).text
            .trim()
            .replace(/^@[^\n]+?\s+(?=(?:暂停|停止|取消|别建))/u, '')
            .replace(/[！!。.?？\s]+$/u, '');
          const task = job.memory.task;

          if (
            task &&
            /^(暂停|暂停任务|停止|停止任务|别建了|取消|取消任务)$/u.test(
              command,
            )
          ) {
            try {
              new TaskService(job.memory).authorize({
                kind: 'player',
                message: event,
              });
            } catch {
              if (!job.attention.enqueue(event))
                log('消息队列已满，当前消息未接收。');
              if (['idle', 'failed'].includes(job.view.status)) ctx.wake(job);
              return;
            }
            void ctx
              .controlMessage(
                job.view.id,
                command.startsWith('取消') ? 'cancel' : 'pause',
                new TaskService(job.memory).lease(),
                `world-${job.attention.generation}-${event.seq}`,
                event,
              )
              .then(() =>
                aiCharacterPermissions(job.view).chat
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

          if (!job.attention.enqueue(event)) {
            log('消息队列已满，当前消息未接收。');
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
        enabled:
          !!job.view.voiceReplies && aiCharacterPermissions(job.view).chat,
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
            beforeNewTask: (_task, previousMemory) =>
              beginChatExecution(
                executionState(job),
                previousMemory,
                config,
                ctx.save,
              ),
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
}

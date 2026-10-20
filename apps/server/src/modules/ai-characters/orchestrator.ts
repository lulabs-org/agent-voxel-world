import { migrateArchive } from './storage';
import { AICharacterWakeScheduler } from './wake-scheduler';
import { appendAICharacterLog } from './logs';
import {
  aiCharacterPermissions,
  type AICharacterSettings,
} from '@voxel/shared';
import { randomUUID } from 'node:crypto';
import type { VoiceServicePort, ProviderPort, ArchivePort } from './ports';
import { AICharacterRegistry } from './types';
import { AICharacterEvents } from './events';
import {
  Session,
  AgentAttention,
  AgentRunner,
  nextIntervalMs,
  type AgentConfig,
} from '@voxel/agent-runtime';

import { object, text, boolean } from '../../common/validation';
import { validateAICharacter, aiCharacterProfileInput } from './validation';
import type { SavedProvider } from '../providers/provider-validation';
import { AppError } from '../../common/errors';

import { active, resident, type Job } from './types';
import {
  pauseTaskForHost,
  markJoined,
  markOffline,
  modelChanged,
} from '../tasks/execution';
import { executionState } from './execution-adapter';
import { restoreAICharacterJob } from './restore';
import { AICharacterHost, type ExecutionContext } from './host';
import { AICharacterPersistence } from './persistence';
import { TaskCoordinator } from '../tasks/coordinator';

export * from './validation';

export class AICharacterOrchestrator {
  readonly jobs = new AICharacterRegistry();
  readonly events = new AICharacterEvents();
  readonly taskScheduler = new AICharacterWakeScheduler();
  readonly persistence: AICharacterPersistence;
  readonly tasks: TaskCoordinator;

  private closing = false;
  private restoreFailed = false;
  private closePromise?: Promise<void>;
  private shutdownPresence = new Map<string, Job['view']['status']>();
  private probing = new Set<string>();

  constructor(
    readonly providers: ProviderPort,
    private serverUrl: string | (() => string),
    private dependencies: AICharacterDependencies,
    readonly voiceServices: VoiceServicePort | undefined,
    private archive: ArchivePort,
  ) {
    this.persistence = new AICharacterPersistence(this.archive, this.events);
    this.tasks = new TaskCoordinator({
      execution: (id) => executionState(this.taskJob(id)),
      findExecution: (id) => {
        const job = this.jobs.get(id);
        return job ? executionState(job) : undefined;
      },
      executions: () => [...this.jobs.values()].map(executionState),
      save: () => this.save(),
      schedule: (id) => {
        const job = this.jobs.get(id);
        if (job) this.schedule(job);
      },
      launch: (id) => this.launchReserved(this.taskJob(id)),
      withStoppedExecution: (id, change) =>
        this.withStoppedExecution(id, change),
      validateExecution: (id, overrides) => {
        const job = this.taskJob(id);
        const settings = validateAICharacter(
          { ...job.view, ...overrides },
          this.providers.get(job.view.providerId),
        );
        this.checkVoice(settings);
        return settings;
      },
      storageFailed: () => this.persistence.planStorageFailed,
      committedName: (id) => this.persistence.committedCharacterName(id),
      publicIdentity: (id) => this.persistence.publicIdentity(id),
      resourceVersion: () => this.events.version,
      isClosing: () => this.closing,
      assertWritable: (id) => this.assertWritable(id),
    });
  }

  get storageRevision() {
    return this.persistence.storageRevision;
  }

  get plans() {
    return this.tasks.plans;
  }

  get committedPlans() {
    return this.tasks.committedPlans;
  }

  get planScheduler() {
    return this.tasks.planScheduler;
  }

  assertWritable(id?: string) {
    if (this.restoreFailed)
      throw new AppError('AI 角色存档恢复失败，请修复存档后重启服务。', 503);
    this.persistence.assertWritable(
      this.closing,
      id ? this.jobs.get(id)?.storageFailed : undefined,
    );
  }

  publicList() {
    return this.persistence.publicList();
  }

  publicIdentity(id: string) {
    return this.persistence.publicIdentity(id);
  }

  async settled(id: string) {
    await this.jobs.get(id)?.done;
  }

  private persist() {
    // Shutdown also runs after failed startup; never replace unread/partially restored data.
    if (this.restoreFailed) return Promise.resolve();
    return this.persistence.persist(
      this.jobs,
      this.plans,
      this.committedPlans,
      this.taskScheduler,
      () => this.list(),
      this.shutdownPresence,
    );
  }

  private save(): Promise<void> {
    return this.persist();
  }

  async flush(since = this.storageRevision) {
    return this.persistence.flush(since);
  }

  async load() {
    try {
      await this.restoreArchive();
    } catch (error) {
      this.restoreFailed = true;
      throw error;
    }
  }

  private async restoreArchive() {
    const raw = await this.archive.load();
    const saved = raw ? migrateArchive(raw) : undefined;
    if (!saved) {
      this.planScheduler.start();
      return;
    }
    Object.assign(this.plans, {
      plans: saved.plans,
      runs: saved.runs,
      requests: saved.requests,
    });
    const autoJoin: Job[] = [];
    for (const view of saved.characters) {
      const { job, voiceWarning, shouldAutoJoin } = restoreAICharacterJob(
        view,
        this.providers,
        (settings) => this.checkVoice(settings),
        this.plans,
      );
      this.jobs.set(view.id, job);
      if (voiceWarning) appendAICharacterLog(job.view, voiceWarning);
      if (shouldAutoJoin) autoJoin.push(job);
    }
    await this.save();
    for (const job of autoJoin.slice(0, 4)) {
      job.view.status = 'joining';
      job.done = this.execute(
        job,
        this.providers.get(job.view.providerId),
        false,
      );
      await job.done;
    }
    this.planScheduler.start();
  }

  currentRunId(id: string) {
    return this.jobs.get(id)?.currentRunId;
  }

  taskIdentity(id: string) {
    return this.jobs.get(id)?.memory.identity;
  }

  interrupt(id: string) {
    this.jobs.get(id)?.abort.abort();
  }

  private checkVoice(settings: AICharacterSettings) {
    if (settings.voiceReplies && !settings.voiceServiceId)
      throw new AppError('请先选择语音服务。');
    if (settings.voiceServiceId)
      this.voiceServices?.get(settings.voiceServiceId);
  }

  private bindVoice(job: Job) {
    if (job.view.sessionId)
      this.voiceServices?.bind(
        job.view.sessionId,
        job.view.voiceReplies && aiCharacterPermissions(job.view).chat
          ? job.view.voiceServiceId || 'local-default'
          : '',
      );
  }

  list() {
    return [...this.jobs.values()]
      .map(({ view, memory, currentRunId }) => {
        const run = this.plans.runs.find((run) => run.id === currentRunId);
        return structuredClone({
          ...view,
          goal: memory.task?.goal ?? view.goal,
          voiceServiceName: this.voiceServices
            ?.list()
            .find((s) => s.id === view.voiceServiceId)?.name,
          task: memory.task,
          taskExecution: run
            ? { runId: run.id, limits: run.snapshot.limits }
            : undefined,
          usage: memory.usage,
          lastResponse: memory.lastResponse,
          taskRequiresReassignment: !!memory.audienceExpired,
          logs: [...view.logs],
        });
      })
      .reverse();
  }

  private taskJob(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new AppError('Agent 不存在。', 404);
    if (this.closing) throw new AppError('世界服务正在关闭。', 503);
    return job;
  }

  private launchReserved(job: Job) {
    this.taskScheduler.cancel(job.view.id);
    job.view.status = 'running';
    job.abort = new AbortController();
    job.done = this.execute(job, this.providers.get(job.view.providerId));
  }

  async models(id: string) {
    if (this.probing.has(id))
      throw new AppError('正在连接此模型服务，请稍候。', 429);
    const provider = this.providers.get(id);
    if (provider.type !== 'ollama' && !provider.apiKey)
      throw new AppError('请先配置 API Key。');
    this.probing.add(id);
    try {
      return await this.dependencies.models(provider);
    } catch {
      throw new AppError(
        '无法获取模型列表，请检查地址、密钥和服务状态。支持的模型 ID 也可手动填写。',
        502,
      );
    } finally {
      this.probing.delete(id);
    }
  }

  create(value: unknown) {
    if (this.closing) throw new AppError('世界服务正在关闭。', 503);
    const input = aiCharacterProfileInput(value);
    const provider = this.providers.get(text(input.providerId, '模型服务', 80));
    const settings = validateAICharacter({ ...input, goal: '' }, provider);
    const joinWorld = boolean(input.joinWorld, true);
    this.checkVoice(settings);
    if (joinWorld && [...this.jobs.values()].filter(resident).length >= 4)
      throw new AppError(
        '最多同时在线 4 个受管理的 Agent（含待命），请先关闭一个。',
        409,
      );
    if (this.jobs.size >= 50)
      throw new AppError(
        '最多保存 50 个 Agent；为保留任务历史，不能自动删除旧角色。',
        409,
      );
    const job: Job = {
      view: {
        ...settings,
        id: randomUUID(),
        providerName: provider.name,
        status: joinWorld ? 'joining' : 'stopped',
        createdAt: Date.now(),
        logs: [],
      },
      abort: new AbortController(),
      memory: {},
      ledger: this.plans,
      attention: new AgentAttention(),
    };
    this.jobs.set(job.view.id, job);
    if (joinWorld) job.done = this.execute(job, provider, false);
    this.persist();
    return this.list().find((v) => v.id === job.view.id)!;
  }

  join(id: string) {
    if (this.closing) throw new AppError('世界服务正在关闭。', 503);
    const job = this.jobs.get(id);
    if (!job) throw new AppError('Agent 不存在。', 404);
    if (resident(job) || job.updating || job.controlling || job.taskMutating)
      throw new AppError('角色已在线或正在更新，请稍候。', 409);
    if ([...this.jobs.values()].filter(resident).length >= 4)
      throw new AppError(
        '最多同时在线 4 个 Agent，请先让一个角色离开世界。',
        409,
      );
    const provider = this.providers.get(job.view.providerId);
    const settings = validateAICharacter(job.view, provider);
    this.checkVoice(settings);
    this.taskScheduler.cancel(job.view.id);
    markJoined(executionState(job));
    Object.assign(job.view, settings, {
      providerName: provider.name,
      status: 'joining',
    });
    job.attention.clear();
    job.abort = new AbortController();
    job.done = this.execute(job, provider, false);
    this.persist();
    return this.list().find((v) => v.id === id)!;
  }

  async update(id: string, value: unknown) {
    if (this.closing) throw new AppError('世界服务正在关闭。', 503);
    const job = this.jobs.get(id);
    if (!job) throw new AppError('Agent 不存在。', 404);
    const input = aiCharacterProfileInput(value);
    if (
      active(job.view.status) ||
      job.updating ||
      job.controlling ||
      job.taskMutating
    )
      throw new AppError('请等待 Agent 待命，或关闭后再修改参数。', 409);
    const provider = this.providers.get(
      text(input.providerId, '模型服务', 80, job.view.providerId),
    );
    const currentGoal = job.memory.task?.goal ?? job.view.goal;
    const settings = validateAICharacter(
      {
        ...job.view,
        ...input,
        goal: currentGoal,
        permissions:
          input.permissions !== undefined
            ? input.permissions
            : input.allowEdits !== undefined
              ? undefined
              : job.view.permissions,
      },
      provider,
    );
    this.checkVoice(settings);
    job.updating = true;
    try {
      const session = job.session;
      if (
        session &&
        (!!settings.voiceReplies && aiCharacterPermissions(settings).chat) !==
          (!!job.view.voiceReplies && aiCharacterPermissions(job.view).chat)
      ) {
        const result = await session.request('agent.voice', {
          enabled:
            !!settings.voiceReplies && aiCharacterPermissions(settings).chat,
        });
        if (!result.ok || job.session !== session || active(job.view.status))
          throw new AppError('语音开关未保存，请刷新后重试。', 409);
      }
      if (session && settings.name !== job.view.name) {
        const result = await session.request('rename', { name: settings.name });
        if (!result.ok || job.session !== session || active(job.view.status))
          throw new AppError('角色状态已变化，未保存参数，请刷新后重试。', 409);
      }
      if (
        settings.providerId !== job.view.providerId ||
        settings.model !== job.view.model
      ) {
        this.taskScheduler.cancel(job.view.id);
        modelChanged(executionState(job));
        job.attention.clear();
      } else if (
        JSON.stringify(aiCharacterPermissions(settings)) !==
          JSON.stringify(aiCharacterPermissions(job.view)) ||
        JSON.stringify(settings.skills) !== JSON.stringify(job.view.skills)
      ) {
        this.taskScheduler.cancel(job.view.id);
        job.attention.clear();
        pauseTaskForHost(
          executionState(job),
          '角色技能或动作权限已修改，进度已保留，请确认后继续。',
        );
        appendAICharacterLog(
          job.view,
          '角色能力已更新；后续按新权限重新规划，已有进度保留。',
        );
      }
      Object.assign(job.view, settings, { providerName: provider.name });
      this.bindVoice(job);
      await this.save();
      return this.list().find((v) => v.id === job.view.id)!;
    } finally {
      job.updating = false;
      this.schedule(job);
    }
  }

  async setVoice(id: string, value: unknown) {
    const job = this.jobs.get(id);
    if (!job) throw new AppError('Agent 不存在。', 404);
    if (
      this.closing ||
      job.updating ||
      job.taskMutating ||
      job.controlling ||
      ['joining', 'stopping'].includes(job.view.status)
    )
      throw new AppError('Agent 状态正在更新，请稍候。', 409);
    const enabled = boolean(object(value).enabled, false);
    if (enabled && !aiCharacterPermissions(job.view).chat)
      throw new AppError('发送聊天权限已关闭，不能开启语音回复。');
    this.checkVoice({ ...job.view, voiceReplies: enabled });
    job.updating = true;
    try {
      if (job.session?.room) {
        const result = await job.session.request('agent.voice', { enabled });
        if (!result.ok) throw new AppError('语音开关未生效，请重试。', 409);
      }
      job.view.voiceReplies = enabled;
      this.bindVoice(job);
      await this.save();
      return this.list().find((v) => v.id === job.view.id)!;
    } finally {
      job.updating = false;
      this.schedule(job);
    }
  }

  private wake(job: Job) {
    if (
      this.closing ||
      job.storageFailed ||
      job.controlling ||
      job.updating ||
      job.taskMutating ||
      (job.view.status !== 'idle' &&
        !(job.view.status === 'failed' && job.attention.pending)) ||
      !job.session
    )
      return;
    this.taskScheduler.cancel(job.view.id);
    job.view.status = 'running';
    job.abort = new AbortController();
    job.done = this.execute(job, this.providers.get(job.view.providerId));
  }

  private schedule(job: Job) {
    this.taskScheduler.cancel(job.view.id);
    if (
      this.closing ||
      job.storageFailed ||
      job.controlling ||
      job.updating ||
      job.taskMutating ||
      (job.view.status !== 'idle' &&
        !(job.view.status === 'failed' && job.attention.pending)) ||
      !job.session
    )
      return;
    if (job.attention.pending) {
      this.taskScheduler.wake(job.view.id, 0, () => this.wake(job));
    } else if (['running', 'waiting'].includes(job.memory.task?.status ?? '')) {
      this.taskScheduler.wake(
        job.view.id,
        job.memory.follow ? 100 : nextIntervalMs(job.view),
        () => this.wake(job),
      );
    }
  }

  /** Host primitive only: stop the runner, then let Tasks commit the chosen transition. */
  private async withStoppedExecution<T>(
    id: string,
    change: () => Promise<T>,
  ): Promise<T> {
    const job = this.taskJob(id);
    if (
      job.updating ||
      job.taskMutating ||
      job.controlling ||
      ['joining', 'stopping'].includes(job.view.status)
    )
      throw new AppError('Agent 状态正在更新，请稍候。', 409);
    job.controlling = true;
    this.taskScheduler.cancel(id);
    job.attention.clear();
    job.abort.abort();
    try {
      await job.done;
      if (job.session) job.view.status = 'idle';
      return await change();
    } finally {
      job.controlling = false;
      this.schedule(job);
    }
  }

  private async execute(job: Job, provider: SavedProvider, run = true) {
    if (job.storageFailed) {
      job.view.status = 'failed';
      return;
    }
    const ctx: ExecutionContext = {
      serverUrl:
        typeof this.serverUrl === 'string' ? this.serverUrl : this.serverUrl(),
      dependencies: this.dependencies,
      voiceServices: this.voiceServices,
      closing: () => this.closing,
      bindVoice: (j) => this.bindVoice(j),
      controlMessage: (targetId, op, identity, commandId, message) =>
        this.tasks.controlMessage(targetId, op, identity, commandId, message),
      wake: (j) => this.wake(j),
      schedule: (j) => this.schedule(j),
      save: () => this.save(),
      persist: () => this.persist(),
    };
    job.host ??= new AICharacterHost(job, ctx);
    return job.host.run(provider, run);
  }

  stop(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new AppError('Agent 不存在。', 404);
    if (
      job.view.status !== 'stopping' &&
      (resident(job) || job.view.status !== 'stopped')
    ) {
      this.taskScheduler.cancel(job.view.id);
      job.view.status = 'stopping';
      job.attention.clear();
      job.abort.abort();
      const closed = job.session
        ?.close()
        .catch(() => job.session?.room?.connection.close());
      const previous = job.done;
      job.done = (async () => {
        await Promise.allSettled([previous, closed]);
        await job.session
          ?.close()
          .catch(() => job.session?.room?.connection.close());
        job.session = undefined;
        delete job.view.sessionId;
        job.view.status = 'stopped';
        markOffline(executionState(job));
        this.persist();
      })();
    }
    return this.list().find((v) => v.id === job.view.id)!;
  }

  async remove(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new AppError('Agent 不存在。', 404);
    if (this.closing || job.updating || job.taskMutating || job.controlling)
      throw new AppError('Agent 状态正在更新，请稍候。', 409);
    job.controlling = true;
    try {
      this.stop(id);
      await job.done;
      const restoreTasks = this.tasks.detachAgent(id, job.view.name);
      this.jobs.delete(id);
      this.persist();
      try {
        await this.flush();
      } catch (error) {
        restoreTasks();
        this.jobs.set(id, job);
        this.persist();
        await this.flush().catch(() => {});
        throw error;
      }
    } finally {
      job.controlling = false;
    }
  }

  async removeProvider(id: string) {
    if ([...this.jobs.values()].some((j) => j.view.providerId === id))
      throw new AppError(
        '已有可复用 Agent 关联此模型服务，请保留配置或更新其密钥。',
        409,
      );
    await this.providers.remove(id);
  }

  async removeVoiceService(id: string) {
    if (!this.voiceServices) throw new AppError('语音服务未就绪。', 503);
    await this.voiceServices.remove(id, () =>
      [...this.jobs.values()].some(
        (j) => j.updating || j.view.voiceServiceId === id,
      ),
    );
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.shutdown());
  }

  private async shutdown() {
    this.taskScheduler.close();
    this.planScheduler.close();
    this.closing = true;
    for (const job of this.jobs.values()) {
      this.shutdownPresence.set(job.view.id, job.view.status);
      this.tasks.pauseForShutdown(job.view.id);
    }
    for (const id of this.jobs.keys()) this.stop(id);
    await Promise.allSettled([...this.jobs.values()].map((j) => j.done));
    await this.save();
    this.events.close();
  }
}

export type AICharacterDependencies = {
  session: (url: string) => Session;
  runner: (
    config: AgentConfig,
    provider: SavedProvider,
  ) => Pick<AgentRunner, 'run'>;
  models: (provider: SavedProvider) => Promise<string[]>;
};

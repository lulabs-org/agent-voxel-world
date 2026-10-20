import { migrateArchive } from './storage';
import { AgentWakeScheduler } from './wake-scheduler';
import { appendAgentLog } from './logs';
import {
  hasPlanTokenLimit,
  agentPermissions,
  type AgentSettings,
} from '@voxel/shared';
import { randomUUID } from 'node:crypto';
import type { VoiceServicePort, ProviderPort, ArchivePort } from './ports';
import { AgentRegistry } from './types';
import { AgentEvents } from './events';
import type { RpcParams } from '@voxel/gateway-protocol';
import {
  Session,
  AgentAttention,
  AgentRunner,
  TaskService,
  nextIntervalMs,
  type AgentConfig,
} from '@voxel/agent-runtime';

import { object, text, boolean } from '../../common/validation';
import { validateAgent, taskLimits, agentProfileInput } from './validation';
import type { SavedProvider } from '../providers/provider-validation';
import { AppError } from '../../common/errors';

import { active, resident, type Job } from './types';
import { captureTask, currentRun, reserveRun } from './task-execution';
import { restoreAgentJob } from './restore';
import { AgentHost, type ExecutionContext } from './host';
import { AgentPersistence } from './persistence';
import { AgentPlanCoordinator } from './plan-coordinator';
import { endedRun, newPlan, validatePlan } from '../tasks';

export * from './validation';

export class AgentOrchestrator {
  readonly jobs = new AgentRegistry();
  readonly events = new AgentEvents();
  readonly taskScheduler = new AgentWakeScheduler();
  readonly persistence: AgentPersistence;
  readonly planCoordinator: AgentPlanCoordinator;

  private closing = false;
  private closePromise?: Promise<void>;
  private shutdownPresence = new Map<string, Job['view']['status']>();
  private probing = new Set<string>();

  constructor(
    readonly providers: ProviderPort,
    private serverUrl: string | (() => string),
    private dependencies: AgentDependencies,
    readonly voiceServices: VoiceServicePort | undefined,
    private archive: ArchivePort,
  ) {
    this.persistence = new AgentPersistence(this.archive, this.events);
    this.planCoordinator = new AgentPlanCoordinator({
      taskJob: (id) => this.taskJob(id),
      jobById: (id) => this.jobs.get(id),
      allJobs: () => this.jobs.values(),
      save: () => this.save(),
      schedule: (job) => this.schedule(job),
      launchReserved: (job) => this.launchReserved(job),
      controlTask: (id, op) => this.controlTask(id, op),
      getProvider: (id) => this.providers.get(id),
      persistence: this.persistence,
      events: this.events,
      isClosing: () => this.closing,
      assertWritable: (id) => this.assertWritable(id),
    });
  }

  get storageRevision() {
    return this.persistence.storageRevision;
  }

  get plans() {
    return this.planCoordinator.plans;
  }

  get committedPlans() {
    return this.planCoordinator.committedPlans;
  }

  get planScheduler() {
    return this.planCoordinator.planScheduler;
  }

  assertWritable(id?: string) {
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

  publicPlans(id?: string, metadata = false) {
    return this.planCoordinator.publicPlans(id, metadata);
  }

  publicRuns(
    id: string | undefined,
    plan: string,
    offset?: number,
    metadata = false,
  ) {
    return this.planCoordinator.publicRuns(id, plan, offset, metadata);
  }

  planPage(p: RpcParams) {
    return this.planCoordinator.planPage(p);
  }

  publicPlan(id: string) {
    return this.planCoordinator.publicPlan(id);
  }

  async reassignPlan(id: string, agentId: string) {
    return this.planCoordinator.reassignPlan(id, agentId);
  }

  async settled(id: string) {
    await this.jobs.get(id)?.done;
  }

  private persist() {
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
    for (const view of saved.agents) {
      const { job, voiceWarning, shouldAutoJoin } = restoreAgentJob(
        view,
        this.providers,
        (settings) => this.checkVoice(settings),
        this.plans,
      );
      this.jobs.set(view.id, job);
      if (voiceWarning) appendAgentLog(job.view, voiceWarning);
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

  private checkVoice(settings: AgentSettings) {
    if (settings.voiceReplies && !settings.voiceServiceId)
      throw new AppError('请先选择语音服务。');
    if (settings.voiceServiceId)
      this.voiceServices?.get(settings.voiceServiceId);
  }

  private bindVoice(job: Job) {
    if (job.view.sessionId)
      this.voiceServices?.bind(
        job.view.sessionId,
        job.view.voiceReplies && agentPermissions(job.view).chat
          ? job.view.voiceServiceId || 'local-default'
          : '',
      );
  }

  list() {
    return [...this.jobs.values()]
      .map(({ view, memory }) =>
        structuredClone({
          ...view,
          goal: memory.task?.goal ?? view.goal,
          voiceServiceName: this.voiceServices
            ?.list()
            .find((s) => s.id === view.voiceServiceId)?.name,
          task: memory.task,
          usage: memory.usage,
          lastResponse: memory.lastResponse,
          taskRequiresReassignment: !!memory.audienceExpired,
          logs: [...view.logs],
        }),
      )
      .reverse();
  }

  private taskJob(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new AppError('Agent 不存在。', 404);
    if (this.closing) throw new AppError('世界服务正在关闭。', 503);
    return job;
  }

  taskPlans(id: string) {
    return this.planCoordinator.taskPlans(id);
  }

  taskRuns(id: string, planId: string, offset = 0) {
    return this.planCoordinator.taskRuns(id, planId, offset);
  }

  private launchReserved(job: Job) {
    this.taskScheduler.cancel(job.view.id);
    job.view.status = 'running';
    job.abort = new AbortController();
    job.done = this.execute(job, this.providers.get(job.view.providerId));
  }

  createTaskPlan(id: string, value: unknown) {
    return this.planCoordinator.createTaskPlan(id, value);
  }

  commitPlan<T>(planId: string, change: () => T) {
    return this.planCoordinator.commitPlan(planId, change);
  }

  updateTaskPlan(id: string | undefined, planId: string, value: unknown) {
    return this.planCoordinator.updateTaskPlan(id, planId, value);
  }

  controlTaskPlan(
    id: string | undefined,
    planId: string,
    operation: string,
    value: unknown = {},
  ) {
    return this.planCoordinator.controlTaskPlan(id, planId, operation, value);
  }

  controlTaskRun(
    id: string | undefined,
    runId: string,
    operation: string,
    value: unknown = {},
  ) {
    return this.planCoordinator.controlTaskRun(id, runId, operation, value);
  }

  dispatchDue(now = Date.now()) {
    return this.planCoordinator.dispatchDue(now);
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
    const input = agentProfileInput(value);
    const provider = this.providers.get(text(input.providerId, '模型服务', 80));
    const settings = validateAgent({ ...input, goal: '' }, provider);
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
    const settings = validateAgent(job.view, provider);
    this.checkVoice(settings);
    this.taskScheduler.cancel(job.view.id);
    // Joining is a presence action: it must never resume a previous task.
    if (
      job.memory.task &&
      ['running', 'waiting', 'paused'].includes(job.memory.task.status)
    ) {
      job.memory.task.status = 'paused';
      job.memory.task.reason = '已加入世界待命，任务进度保留。';
    }
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

  resume(id: string, value: unknown = {}) {
    if (this.closing) throw new AppError('世界服务正在关闭。', 503);
    const job = this.jobs.get(id);
    if (!job) throw new AppError('Agent 不存在。', 404);
    if (
      active(job.view.status) ||
      job.updating ||
      job.controlling ||
      job.taskMutating
    )
      throw new AppError('Agent 正在运行或关闭，请稍候。', 409);
    const input = object(value);
    if (job.memory.audienceExpired && input.goal === undefined)
      throw new AppError(
        '原私聊会话已失效，请重新通过聊天发起，避免向错误的玩家发送进展。',
        409,
      );
    const provider = this.providers.get(job.view.providerId);
    const settings = validateAgent(
      {
        ...job.view,
        goal: input.goal ?? job.memory.task?.goal ?? job.view.goal,
        ...taskLimits(input),
      },
      provider,
    );
    if (!settings.goal) throw new AppError('请先布置任务。');
    this.checkVoice(settings);
    if (!job.session && [...this.jobs.values()].filter(resident).length >= 4)
      throw new AppError('最多同时在线 4 个 Agent，请先关闭一个。', 409);
    this.taskScheduler.cancel(job.view.id);
    captureTask(job);
    if (
      input.goal !== undefined ||
      !job.memory.task ||
      ['completed', 'cancelled'].includes(job.memory.task.status)
    ) {
      const previousRun = currentRun(job);
      const previousPlan = job.ledger.plans.find(
        (p) => p.id === previousRun?.planId,
      );
      if (input.goal === undefined && previousPlan) {
        if (previousPlan.state === 'archived')
          throw new AppError('任务已归档，请创建新任务。');
        if (
          hasPlanTokenLimit(previousPlan) &&
          previousPlan.spentTokens >= previousPlan.totalTokenBudget
        )
          throw new AppError('请先追加计划累计额度。');
        reserveRun(job, previousPlan, 'manual', Date.now());
      } else {
        const plan = {
          ...newPlan(
            validatePlan({
              name: settings.goal.slice(0, 80),
              goal: settings.goal,
              timing: { kind: 'immediate' },
              timeZone: 'UTC',
              limits: settings,
            }),
            Date.now(),
          ),
          agentId: id,
          agentName: job.view.name,
        };
        this.plans.plans.push(plan);
        reserveRun(job, plan, 'manual', Date.now());
      }
    } else {
      const task = job.memory.task;
      if (
        currentRun(job)?.snapshot.limits.enabled !== false &&
        (task.calls >= settings.maxTurns ||
          task.tokens >= settings.tokenBudget! ||
          task.elapsedMs >= settings.taskTimeoutMs!)
      )
        throw new AppError('请增加本次执行的总额度后再继续。');
      new TaskService(job.memory).command(
        { type: 'resume' },
        { kind: 'operator' },
        {
          ...settings,
          ...(currentRun(job)?.snapshot.limits.enabled === false
            ? {
                maxTurns: Infinity,
                tokenBudget: Infinity,
                taskTimeoutMs: Infinity,
              }
            : {}),
          apiKey: '',
        },
      );
    }
    const resumedRecord = currentRun(job);
    if (resumedRecord)
      resumedRecord.snapshot.limits = {
        enabled: resumedRecord.snapshot.limits.enabled,
        maxTurns: settings.maxTurns,
        tokenBudget: settings.tokenBudget!,
        taskTimeoutMs: settings.taskTimeoutMs!,
      };
    Object.assign(job.view, settings, {
      providerName: provider.name,
      status: job.session ? 'running' : 'joining',
    });
    job.abort = new AbortController();
    job.done = this.execute(job, provider);
    this.persist();
    return this.list().find((v) => v.id === job.view.id)!;
  }

  async update(id: string, value: unknown) {
    if (this.closing) throw new AppError('世界服务正在关闭。', 503);
    const job = this.jobs.get(id);
    if (!job) throw new AppError('Agent 不存在。', 404);
    const input = agentProfileInput(value);
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
    const settings = validateAgent(
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
        (!!settings.voiceReplies && agentPermissions(settings).chat) !==
          (!!job.view.voiceReplies && agentPermissions(job.view).chat)
      ) {
        const result = await session.request('agent.voice', {
          enabled: !!settings.voiceReplies && agentPermissions(settings).chat,
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
        if (
          job.memory.task &&
          !['completed', 'cancelled'].includes(job.memory.task.status)
        ) {
          new TaskService(job.memory).command(
            { type: 'pause' },
            { kind: 'operator' },
            { ...settings, apiKey: '' },
          );
          job.memory.task.reason = '模型已修改，进度已保留，请确认后继续。';
        }
        if (job.memory.pi?.inFlight)
          job.memory.unknownEffect = {
            ...job.memory.pi.inFlight,
            state: 'unknown',
          };
        delete job.memory.pi;
        job.attention.clear();
      } else if (
        JSON.stringify(agentPermissions(settings)) !==
          JSON.stringify(agentPermissions(job.view)) ||
        JSON.stringify(settings.skills) !== JSON.stringify(job.view.skills)
      ) {
        this.taskScheduler.cancel(job.view.id);
        job.attention.clear();
        if (
          job.memory.task &&
          !['completed', 'cancelled'].includes(job.memory.task.status)
        ) {
          new TaskService(job.memory).command(
            { type: 'pause' },
            { kind: 'operator' },
            { ...settings, apiKey: '' },
          );
          job.memory.task.reason =
            '角色技能或动作权限已修改，进度已保留，请确认后继续。';
        }
        appendAgentLog(
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
    if (enabled && !agentPermissions(job.view).chat)
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

  async controlTask(id: string, operation: 'pause' | 'cancel') {
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
    const taskEnded = () =>
      !!job.memory.task &&
      ['completed', 'cancelled'].includes(job.memory.task.status);
    if (taskEnded() && !active(job.view.status)) {
      await this.flush();
      return this.list().find((v) => v.id === id)!;
    }
    job.controlling = true;
    this.taskScheduler.cancel(job.view.id);
    job.attention.clear();
    job.abort.abort();
    try {
      await job.done;
      if (job.memory.task && !taskEnded()) {
        new TaskService(job.memory).command(
          { type: operation },
          { kind: 'operator' },
          { ...job.view, apiKey: '' },
        );
      }
      if (job.session) job.view.status = 'idle';
      await this.save();
      return this.list().find((v) => v.id === id)!;
    } finally {
      job.controlling = false;
    }
  }

  async assignTask(id: string, value: unknown) {
    const input = object(value);
    const goal = text(input.goal, '任务目标', 2000);
    if (!goal) throw new AppError('请填写任务目标。');
    const job = this.jobs.get(id);
    if (!job) throw new AppError('Agent 不存在。', 404);
    const limits = taskLimits(input);
    validateAgent(
      { ...job.view, ...limits, goal },
      this.providers.get(job.view.providerId),
    );
    await this.controlTask(id, 'pause');
    return this.resume(id, { goal, ...limits });
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
      controlTask: (targetId, op) => this.controlTask(targetId, op),
      wake: (j) => this.wake(j),
      schedule: (j) => this.schedule(j),
      save: () => this.save(),
      persist: () => this.persist(),
    };
    job.host ??= new AgentHost(job, ctx);
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
        if (
          job.memory.task &&
          ['running', 'waiting'].includes(job.memory.task.status)
        ) {
          new TaskService(job.memory).command(
            { type: 'pause' },
            { kind: 'operator' },
            { ...job.view, apiKey: '' },
          );
          job.memory.task.reason = '角色已离开世界，任务进度已保留。';
        }
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
      captureTask(job);
      const priorPlans = structuredClone(
        this.plans.plans.filter((p) => p.agentId === id),
      );
      const priorRuns = structuredClone(
        this.plans.runs.filter((r) => r.agentId === id),
      );
      for (const run of this.plans.runs.filter(
        (r) => r.agentId === id && !endedRun(r),
      )) {
        if (run.runtime?.task) {
          new TaskService(run.runtime).command(
            { type: 'cancel' },
            { kind: 'operator' },
            { ...job.view, apiKey: '' },
          );
          delete run.runtime.follow;
          run.task = structuredClone(run.runtime.task);
        }
        run.status = 'cancelled';
        run.reason = '执行角色已删除。';
        run.finishedAt = Date.now();
      }
      this.plans.detach(id, job.view.name);
      this.jobs.delete(id);
      this.persist();
      try {
        await this.flush();
      } catch (error) {
        for (const p of priorPlans) {
          const idx = this.plans.plans.findIndex((x) => x.id === p.id);
          this.plans.plans[idx] = p;
        }
        this.plans.runs = [
          ...this.plans.runs.filter((r) => r.agentId !== id),
          ...priorRuns,
        ];
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
      if (['running', 'waiting'].includes(job.memory.task?.status ?? '')) {
        const run = currentRun(job),
          plan = job.ledger.plans.find((p) => p.id === run?.planId);
        if (plan) {
          plan.state = 'paused';
          plan.reason = '服务关闭，进度保留，请手动继续。';
          delete plan.nextRunAt;
        }
      }
    }
    for (const id of this.jobs.keys()) this.stop(id);
    await Promise.allSettled([...this.jobs.values()].map((j) => j.done));
    await this.save();
    this.events.close();
  }
}

export type AgentDependencies = {
  session: (url: string) => Session;
  runner: (
    config: AgentConfig,
    provider: SavedProvider,
  ) => Pick<AgentRunner, 'run'>;
  models: (provider: SavedProvider) => Promise<string[]>;
};

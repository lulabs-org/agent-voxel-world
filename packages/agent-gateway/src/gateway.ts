import { appendAgentLog } from './agent-logs';
import {
  TaskScheduler,
  emptyTaskBook,
  validatePlan,
  newPlan,
  newRun,
  nextOccurrence,
  duePlans,
} from './scheduler';
import {
  hasPlanTokenLimit,
  isRepeating,
  agentPermissions,
  type AgentSettings,
} from '@voxel/shared';
import { randomUUID } from 'node:crypto';
import type {
  VoiceServicePort,
  ProviderPort,
  ArchivePort,
  RestoredAgentRecord,
} from './ports';
import { AgentRegistry } from './registry';
import { GatewayEvents } from './events';
import { CommandRouter } from './command-router';
import { invokeGateway } from './dispatch';
import type { RpcParams, RpcMethod } from '@voxel/gateway-protocol';
import {
  Session,
  newTask,
  AgentAttention,
  AgentRunner,
  TaskService,
  listModels,
  nextIntervalMs,
  type AgentConfig,
} from '@voxel/agent-runtime';

import {
  object,
  text,
  boolean,
  validateAgent,
  taskLimits,
  type SavedProvider,
} from './validation';
import { ManagementError } from './errors';

import { active, resident, type Job } from './types';
import {
  captureTask,
  commitTaskBook,
  currentRun,
  getTaskPlans,
  getTaskRuns,
  reserveRun,
  taskBusy,
  executeTaskPlanControl,
  executeTaskRunControl,
} from './task-operations';
import { restoreAgentJob } from './restore';
import { AgentHost, type ExecutionContext } from './executor';

export * from './validation';

export class AgentGateway {
  private jobs = new AgentRegistry();
  readonly events = new GatewayEvents();
  readonly commands = new CommandRouter();
  private closing = false;
  private closePromise?: Promise<void>;
  private shutdownPresence = new Map<string, Job['view']['status']>();
  private probing = new Set<string>();
  private taskScheduler = new TaskScheduler(() => this.dispatchDue());
  private saving: Promise<void> = Promise.resolve();
  private committed = new Map<string, RestoredAgentRecord>();
  private committedViews: ReturnType<AgentGateway['list']> = [];
  storageRevision = 0;

  assertWritable(id?: string) {
    if (this.closing) throw new ManagementError('世界服务正在关闭。', 503);
    if (id && this.jobs.get(id)?.storageFailed)
      throw new ManagementError(
        '存档失败，已停止此 Agent 的后续动作。请修复存储后重启服务。',
        503,
      );
  }
  publicList() {
    return structuredClone(this.committedViews);
  }
  publicIdentity(id: string) {
    return structuredClone(this.committed.get(id)?.runtime?.identity);
  }
  private committedJob(id: string): Job {
    const r = this.committed.get(id);
    if (!r) throw new ManagementError('Agent 不存在。', 404);
    return {
      view: structuredClone(r),
      memory: structuredClone(r.runtime ?? {}),
      book: structuredClone(r.taskBook ?? emptyTaskBook()),
      attention: new AgentAttention(),
      abort: new AbortController(),
    };
  }
  publicPlans(id: string, metadata = false) {
    const plans = getTaskPlans(this.committedJob(id));
    return metadata
      ? plans.map((plan) => ({
          ...plan,
          resourceVersion: this.events.version,
          taskIdentity: this.publicIdentity(id) ?? null,
        }))
      : plans;
  }
  publicRuns(id: string, plan: string, offset?: number, metadata = false) {
    const job = this.committedJob(id),
      page = getTaskRuns(job, plan, offset);
    if (!metadata) return page;
    const annotate = (run: (typeof page.items)[number]) => ({
      ...run,
      resourceVersion: this.events.version,
      taskIdentity:
        job.book.runs.find((r) => r.id === run.id)?.runtime?.identity ?? null,
    });
    return {
      ...page,
      resourceVersion: this.events.version,
      taskIdentity: this.publicIdentity(id) ?? null,
      items: page.items.map(annotate),
      active: page.active.map(annotate),
    };
  }
  async settled(id: string) {
    await this.jobs.get(id)?.done;
  }

  private persist() {
    for (const job of this.jobs.values()) captureTask(job);
    const views = this.list();
    const records = [...views].reverse().map((view) => ({
      ...view,
      status: this.shutdownPresence.get(view.id) ?? view.status,
      sessionId: undefined,
      runtime: structuredClone(this.jobs.get(view.id)?.memory),
      taskBook: structuredClone(this.jobs.get(view.id)?.book),
    }));
    this.saving = this.saving
      .catch(() => {})
      .then(async () => {
        try {
          await this.archive.save(records);
        } catch (error) {
          this.storageRevision++;
          for (const record of records) {
            if (
              JSON.stringify(this.committed.get(record.id)) ===
              JSON.stringify(record)
            )
              continue;
            const job = this.jobs.get(record.id);
            if (job) {
              job.storageFailed = true;
              job.abort.abort();
              this.taskScheduler.cancel(record.id);
            }
          }
          throw error;
        }
        this.committed = new Map(records.map((record) => [record.id, record]));
        this.committedViews = views;
        this.events.commit(records);
      });
    void this.saving.catch(() => console.error('无法保存 Agent 记录。'));
  }

  private save(): Promise<void> {
    this.persist();
    return this.saving;
  }

  async load() {
    const saved = await this.archive.load();
    if (!saved) {
      this.taskScheduler.start();
      return;
    }
    for (const view of saved) {
      const { job, voiceWarning, shouldAutoJoin } = restoreAgentJob(
        view,
        this.providers,
        (settings) => this.checkVoice(settings),
      );
      this.jobs.set(view.id, job);
      if (voiceWarning) appendAgentLog(job.view, voiceWarning);
      if (
        shouldAutoJoin &&
        [...this.jobs.values()].filter(resident).length < 4
      ) {
        job.view.status = 'joining';
        job.done = this.execute(
          job,
          this.providers.get(job.view.providerId),
          false,
        );
        await job.done;
      }
    }
    await this.save();
    this.taskScheduler.start();
  }

  constructor(
    readonly providers: ProviderPort,
    private serverUrl: string | (() => string),
    private dependencies: GatewayDependencies,
    readonly voiceServices: VoiceServicePort | undefined,
    private archive: ArchivePort,
  ) {}

  async dispatch(
    method: RpcMethod,
    params: RpcParams,
    commandId?: string,
    legacy = false,
  ) {
    return invokeGateway(this, method, params, commandId, legacy);
  }
  async flush(since = this.storageRevision) {
    await this.saving;
    if (since !== this.storageRevision)
      throw new ManagementError('保存失败，操作结果待确认，请检查存储。', 503);
  }
  currentRunId(id: string) {
    return this.jobs.get(id)?.book.currentRunId;
  }
  taskIdentity(id: string) {
    return this.jobs.get(id)?.memory.identity;
  }
  interrupt(id: string) {
    this.jobs.get(id)?.abort.abort();
  }
  private checkVoice(settings: AgentSettings) {
    if (settings.voiceReplies && !settings.voiceServiceId)
      throw new ManagementError('请先选择语音服务。');
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
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (this.closing) throw new ManagementError('世界服务正在关闭。', 503);
    return job;
  }

  taskPlans(id: string) {
    return getTaskPlans(this.taskJob(id));
  }

  taskRuns(id: string, planId: string, offset = 0) {
    return getTaskRuns(this.taskJob(id), planId, offset);
  }

  private launchReserved(job: Job) {
    this.taskScheduler.cancel(job.view.id);
    job.view.status = 'running';
    job.abort = new AbortController();
    job.done = this.execute(job, this.providers.get(job.view.providerId));
  }

  async createTaskPlan(id: string, value: unknown) {
    const job = this.taskJob(id);
    const requestId = object(value).requestId;
    if (
      requestId !== undefined &&
      (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(requestId))
    )
      throw new ManagementError('请求标识无效。');
    const priorId =
      typeof requestId === 'string' &&
      job.book.requests &&
      Object.hasOwn(job.book.requests, requestId)
        ? job.book.requests[requestId]
        : undefined;
    if (priorId)
      return structuredClone(job.book.plans.find((p) => p.id === priorId)!);
    const draft = validatePlan(value);
    if (draft.timing.kind === 'immediate' && (!job.session || taskBusy(job)))
      throw new ManagementError('请先让角色上线并结束或暂停当前执行。', 409);
    let runId: string | undefined;
    const plan = await commitTaskBook(
      job,
      () => {
        const p = newPlan(draft, Date.now());
        job.book.plans.push(p);
        if (p.timing.kind === 'immediate')
          runId = reserveRun(job, p, 'manual', Date.now());
        if (typeof requestId === 'string')
          (job.book.requests ??= {})[requestId] = p.id;
        return p;
      },
      () => this.save(),
      (j) => this.schedule(j),
      draft.timing.kind === 'immediate',
    );
    if (runId) this.launchReserved(job);
    this.taskScheduler.start();
    return structuredClone(plan);
  }

  async updateTaskPlan(id: string, planId: string, value: unknown) {
    const job = this.taskJob(id),
      plan = job.book.plans.find((p) => p.id === planId);
    if (!plan) throw new ManagementError('任务不存在。', 404);
    if (plan.state === 'archived')
      throw new ManagementError('已归档任务不能修改。');
    const draft = validatePlan(value, Date.now(), plan);
    return commitTaskBook(
      job,
      () => {
        Object.assign(plan, draft, { updatedAt: Date.now() });
        plan.nextRunAt =
          plan.state === 'enabled'
            ? nextOccurrence(plan, Date.now())
            : undefined;
        return structuredClone(plan);
      },
      () => this.save(),
      (j) => this.schedule(j),
    );
  }

  async controlTaskPlan(
    id: string,
    planId: string,
    operation: string,
    value: unknown = {},
  ) {
    const job = this.taskJob(id);
    return executeTaskPlanControl(
      job,
      planId,
      operation,
      value,
      () => this.save(),
      (j) => this.schedule(j),
      (j) => this.launchReserved(j),
    );
  }

  async controlTaskRun(
    id: string,
    runId: string,
    operation: string,
    value: unknown = {},
  ) {
    const job = this.taskJob(id);
    return executeTaskRunControl(
      job,
      runId,
      operation,
      value,
      this.providers.get(job.view.providerId),
      () => this.save(),
      (j) => this.schedule(j),
      (j) => this.launchReserved(j),
      (op) => this.controlTask(id, op),
    );
  }

  async dispatchDue(now = Date.now()) {
    if (this.closing) return;
    for (const job of this.jobs.values()) {
      if (
        job.storageFailed ||
        job.taskMutating ||
        job.updating ||
        job.controlling
      )
        continue;
      const due = duePlans(job.book, now);
      let selected = false;
      for (const plan of due) {
        const at = plan.nextRunAt!;
        const skip =
          selected || taskBusy(job)
            ? '角色忙碌，本次触发已跳过。'
            : !job.session
              ? '角色离线，本次触发已错过。'
              : undefined;
        let runId: string | undefined;
        await commitTaskBook(
          job,
          () => {
            if (
              hasPlanTokenLimit(plan) &&
              plan.spentTokens >= plan.totalTokenBudget
            ) {
              plan.state = 'paused';
              plan.reason = '累计额度已用尽。';
              delete plan.nextRunAt;
              return;
            }
            runId = reserveRun(job, plan, 'scheduled', at, skip);
            plan.nextRunAt = isRepeating(plan.timing)
              ? nextOccurrence(plan, now)
              : undefined;
          },
          () => this.save(),
          (j) => this.schedule(j),
          !skip,
        );
        if (runId) {
          selected = true;
          this.launchReserved(job);
        }
      }
    }
  }

  async models(id: string) {
    if (this.probing.has(id))
      throw new ManagementError('正在连接此模型服务，请稍候。', 429);
    const provider = this.providers.get(id);
    if (provider.type !== 'ollama' && !provider.apiKey)
      throw new ManagementError('请先配置 API Key。');
    this.probing.add(id);
    try {
      return await this.dependencies.models(provider);
    } catch {
      throw new ManagementError(
        '无法获取模型列表，请检查地址、密钥和服务状态。支持的模型 ID 也可手动填写。',
        502,
      );
    } finally {
      this.probing.delete(id);
    }
  }

  create(value: unknown) {
    if (this.closing) throw new ManagementError('世界服务正在关闭。', 503);
    const provider = this.providers.get(
      text(object(value).providerId, '模型服务', 80),
    );
    const settings = validateAgent(value, provider);
    const startTask = boolean(object(value).startTask, true);
    if (startTask && !settings.goal)
      throw new ManagementError('请填写任务目标，或选择加入世界待命。');
    const firstTask = startTask
      ? validatePlan({
          name: settings.goal.slice(0, 80),
          goal: settings.goal,
          timing: { kind: 'immediate' },
          timeZone: object(value).taskTimeZone ?? 'UTC',
          limits: {
            maxTurns: settings.maxTurns,
            tokenBudget: settings.tokenBudget,
            taskTimeoutMs: settings.taskTimeoutMs,
          },
        })
      : undefined;
    this.checkVoice(settings);
    if ([...this.jobs.values()].filter(resident).length >= 4)
      throw new ManagementError(
        '最多同时在线 4 个受管理的 Agent（含待命），请先关闭一个。',
        409,
      );
    if (this.jobs.size >= 50)
      throw new ManagementError(
        '最多保存 50 个 Agent；为保留任务历史，不能自动删除旧角色。',
        409,
      );
    const job: Job = {
      view: {
        ...settings,
        id: randomUUID(),
        providerName: provider.name,
        status: 'joining',
        createdAt: Date.now(),
        logs: [],
      },
      abort: new AbortController(),
      memory: startTask ? { task: newTask(settings.goal) } : {},
      book: emptyTaskBook(),
      attention: new AgentAttention(),
    };
    if (firstTask) {
      const plan = newPlan(firstTask, job.view.createdAt);
      const run = newRun(plan, job.view.createdAt, 'manual');
      run.task = job.memory.task;
      job.book.plans.push(plan);
      job.book.runs.push(run);
      job.book.currentRunId = run.id;
    }
    this.jobs.set(job.view.id, job);
    captureTask(job);
    const createdRun = currentRun(job);
    if (createdRun) createdRun.source = 'manual';
    this.taskScheduler.start();
    job.done = this.execute(job, provider, startTask);
    this.persist();
    return this.list().find((v) => v.id === job.view.id)!;
  }

  join(id: string) {
    if (this.closing) throw new ManagementError('世界服务正在关闭。', 503);
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (resident(job) || job.updating || job.controlling || job.taskMutating)
      throw new ManagementError('角色已在线或正在更新，请稍候。', 409);
    if ([...this.jobs.values()].filter(resident).length >= 4)
      throw new ManagementError(
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
    if (this.closing) throw new ManagementError('世界服务正在关闭。', 503);
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (
      active(job.view.status) ||
      job.updating ||
      job.controlling ||
      job.taskMutating
    )
      throw new ManagementError('Agent 正在运行或关闭，请稍候。', 409);
    const input = object(value);
    if (job.memory.audienceExpired && input.goal === undefined)
      throw new ManagementError(
        '原私聊会话已失效，请重新布置任务，避免向错误的玩家发送进展。',
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
    if (!settings.goal) throw new ManagementError('请先布置任务。');
    this.checkVoice(settings);
    if (!job.session && [...this.jobs.values()].filter(resident).length >= 4)
      throw new ManagementError('最多同时在线 4 个 Agent，请先关闭一个。', 409);
    this.taskScheduler.cancel(job.view.id);
    captureTask(job);
    if (
      input.goal !== undefined ||
      !job.memory.task ||
      ['completed', 'cancelled'].includes(job.memory.task.status)
    ) {
      const previousRun = currentRun(job);
      const previousPlan = job.book.plans.find(
        (p) => p.id === previousRun?.planId,
      );
      if (input.goal === undefined && previousPlan) {
        if (previousPlan.state === 'archived')
          throw new ManagementError('任务已归档，请创建新任务。');
        if (
          hasPlanTokenLimit(previousPlan) &&
          previousPlan.spentTokens >= previousPlan.totalTokenBudget
        )
          throw new ManagementError('请先追加计划累计额度。');
        reserveRun(job, previousPlan, 'manual', Date.now());
      } else {
        delete job.book.currentRunId;
        job.memory = { usage: job.memory.usage, task: newTask(settings.goal) };
      }
    } else {
      const task = job.memory.task;
      if (
        currentRun(job)?.snapshot.limits.enabled !== false &&
        (task.calls >= settings.maxTurns ||
          task.tokens >= settings.tokenBudget! ||
          task.elapsedMs >= settings.taskTimeoutMs!)
      )
        throw new ManagementError('请增加本次执行的总额度后再继续。');
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
    if (this.closing) throw new ManagementError('世界服务正在关闭。', 503);
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (
      active(job.view.status) ||
      job.updating ||
      job.controlling ||
      job.taskMutating
    )
      throw new ManagementError('请等待 Agent 待命，或关闭后再修改参数。', 409);
    const input = object(value);
    const provider = this.providers.get(
      text(input.providerId, '模型服务', 80, job.view.providerId),
    );
    const currentGoal = job.memory.task?.goal ?? job.view.goal;
    const settings = validateAgent(
      {
        ...job.view,
        goal: currentGoal,
        ...input,
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
          throw new ManagementError('语音开关未保存，请刷新后重试。', 409);
      }
      if (session && settings.name !== job.view.name) {
        const result = await session.request('rename', { name: settings.name });
        if (!result.ok || job.session !== session || active(job.view.status))
          throw new ManagementError(
            '角色状态已变化，未保存参数，请刷新后重试。',
            409,
          );
      }
      if (
        settings.goal !== currentGoal ||
        settings.providerId !== job.view.providerId ||
        settings.model !== job.view.model
      ) {
        this.taskScheduler.cancel(job.view.id);
        captureTask(job);
        delete job.book.currentRunId;
        job.memory = {
          usage: job.memory.usage,
          task: settings.goal
            ? {
                ...newTask(settings.goal),
                status: 'paused',
                reason: '参数已修改，等待继续。',
              }
            : undefined,
        };
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
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (
      this.closing ||
      job.updating ||
      job.taskMutating ||
      job.controlling ||
      ['joining', 'stopping'].includes(job.view.status)
    )
      throw new ManagementError('Agent 状态正在更新，请稍候。', 409);
    const enabled = boolean(object(value).enabled, false);
    if (enabled && !agentPermissions(job.view).chat)
      throw new ManagementError('发送聊天权限已关闭，不能开启语音回复。');
    this.checkVoice({ ...job.view, voiceReplies: enabled });
    job.updating = true;
    try {
      if (job.session?.room) {
        const result = await job.session.request('agent.voice', { enabled });
        if (!result.ok)
          throw new ManagementError('语音开关未生效，请重试。', 409);
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
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (
      this.closing ||
      job.updating ||
      job.taskMutating ||
      job.controlling ||
      ['joining', 'stopping'].includes(job.view.status)
    )
      throw new ManagementError('Agent 状态正在更新，请稍候。', 409);
    const taskEnded = () =>
      !!job.memory.task &&
      ['completed', 'cancelled'].includes(job.memory.task.status);
    // Repeated controls on an ended task are idempotent. An active reply can
    // still be interrupted, but must not rewrite the task it follows.
    if (taskEnded() && !active(job.view.status)) {
      await this.saving;
      return this.list().find((v) => v.id === id)!;
    }
    job.controlling = true;
    this.taskScheduler.cancel(job.view.id);
    job.attention.clear();
    job.abort.abort();
    try {
      await job.done;
      // Completion can win while the in-flight runner settles after abort.
      // Recheck here rather than relying on the status at request admission.
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
    if (!goal) throw new ManagementError('请填写任务目标。');
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
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
      controlTask: (targetId, op, identity, commandId) =>
        this.dispatch(
          `tasks.${op}`,
          { agentId: targetId, expectedTask: identity },
          commandId,
        ),
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
    if (!job) throw new ManagementError('Agent 不存在。', 404);
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
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (this.closing || job.updating || job.taskMutating || job.controlling)
      throw new ManagementError('Agent 状态正在更新，请稍候。', 409);
    // Block scheduling and mutations until all in-flight effects have settled.
    job.controlling = true;
    try {
      this.stop(id);
      await job.done;
      this.jobs.delete(id);
      this.persist();
      try {
        await this.saving;
      } catch (error) {
        // A failed archive write must leave a stopped, recoverable character.
        this.jobs.set(id, job);
        this.persist();
        await this.saving.catch(() => {});
        throw error;
      }
    } finally {
      job.controlling = false;
    }
  }
  async removeProvider(id: string) {
    if ([...this.jobs.values()].some((j) => j.view.providerId === id))
      throw new ManagementError(
        '已有可复用 Agent 关联此模型服务，请保留配置或更新其密钥。',
        409,
      );
    await this.providers.remove(id);
  }

  async removeVoiceService(id: string) {
    if (!this.voiceServices) throw new ManagementError('语音服务未就绪。', 503);
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
    this.closing = true;
    for (const job of this.jobs.values()) {
      this.shutdownPresence.set(job.view.id, job.view.status);
      if (['running', 'waiting'].includes(job.memory.task?.status ?? '')) {
        const run = currentRun(job),
          plan = job.book.plans.find((p) => p.id === run?.planId);
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

export type GatewayDependencies = {
  session: (url: string) => Session;
  runner: (
    config: AgentConfig,
    provider: SavedProvider,
  ) => Pick<AgentRunner, 'run'>;
  models: (provider: SavedProvider) => Promise<string[]>;
};

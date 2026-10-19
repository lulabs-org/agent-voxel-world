import { randomUUID } from 'node:crypto';
import type { AgentTask, WorldEvent, ChatData } from '@voxel/shared';
import type { AgentConfig } from '../contracts';
import { AgentRuntimeError } from '../errors';
import { cap, type RequestBudget } from './budget';
import { newTask, type AgentRunState } from './state';

export type TaskCommand =
  | { type: 'start'; goal: string }
  | { type: 'revise'; goal: string }
  | { type: 'pause' | 'resume' | 'cancel' };
export type TaskAuthority =
  | { kind: 'operator' }
  | { kind: 'player'; message: WorldEvent };
export type TaskLease = { id: string; revision: number; startedAt: number };
export type TaskOutcome =
  | { status: 'completed' | 'blocked' | 'needs_input'; reason: string }
  | {
      status: 'waiting';
      reason: string;
      waitFor: 'world' | 'players';
      signature: string;
    };

/** All task state changes use the same policy, independent of models and transports. */
export class TaskService {
  constructor(readonly memory: AgentRunState) {}

  lease(): TaskLease {
    this.memory.version = 2;
    const task = this.memory.task;
    if (!task) throw new AgentRuntimeError('没有当前任务。');
    if (
      !this.memory.identity ||
      this.memory.identity.startedAt !== task.startedAt
    )
      this.memory.identity = {
        id: randomUUID(),
        revision: 0,
        startedAt: task.startedAt,
      };
    return { ...this.memory.identity };
  }

  current(lease: TaskLease) {
    const now = this.memory.identity;
    return (
      !!this.memory.task &&
      this.memory.task.startedAt === lease.startedAt &&
      now?.id === lease.id &&
      now.revision === lease.revision
    );
  }

  assertCurrent(lease: TaskLease) {
    if (!this.current(lease))
      throw new AgentRuntimeError('任务已修改，忽略过期执行结果。', true);
  }

  authorize(authority: TaskAuthority) {
    if (authority.kind === 'operator') return;
    const task = this.memory.task;
    const message = authority.message;
    const privateTo =
      (message.data as ChatData).scope !== 'public' ? message.actor : undefined;
    if (
      task &&
      !['completed', 'cancelled'].includes(task.status) &&
      ((task.owner && task.owner !== message.actor) ||
        (task.privateTo && task.privateTo !== privateTo))
    )
      throw new AgentRuntimeError(
        '保留原任务：仅任务发起者可修改或取消，请由发起者操作或在控制台安排新任务。',
      );
  }

  /** Synchronous mutation. The caller must commit it before allowing any world effect. */
  command(
    command: TaskCommand,
    authority: TaskAuthority,
    config: AgentConfig,
  ): AgentTask {
    this.authorize(authority);
    const memory = this.memory;
    let task = memory.task;
    if (command.type === 'start' || command.type === 'revise') {
      if (!command.goal.trim() || command.goal.length > 2000)
        throw new AgentRuntimeError('任务目标无效。');
    }
    if (command.type === 'start') {
      if (task && !['completed', 'cancelled'].includes(task.status))
        throw new AgentRuntimeError(
          '已有正在执行或未结束的任务，请修改或取消原任务。',
        );
      const message =
        authority.kind === 'player' ? authority.message : undefined;
      task = newTask(
        command.goal.trim(),
        message?.actor,
        message && (message.data as ChatData).scope !== 'public'
          ? message.actor
          : undefined,
      );
      for (const key of Object.keys(memory))
        if (key !== 'usage' && key !== 'lastChatAt')
          delete (memory as Record<string, unknown>)[key];
      memory.task = task;
      this.lease();
      return task;
    }
    if (!task) throw new AgentRuntimeError('没有可控制的任务，请先布置任务。');
    if (['completed', 'cancelled'].includes(task.status)) {
      if (command.type === 'pause' || command.type === 'cancel') return task;
      throw new AgentRuntimeError(
        '任务已结束，请在控制台重新执行或布置新任务。',
      );
    }
    if (command.type === 'resume' || command.type === 'revise') {
      if (memory.audienceExpired)
        throw new AgentRuntimeError('原私聊会话已失效，请重新通过聊天发起。');
      const reason = cap(task, config);
      if (reason) throw new AgentRuntimeError(reason);
    }
    this.lease();
    memory.identity!.revision++;
    // The old transcript may contain queued tool calls against the old revision.
    if (memory.pi) memory.pi.messages = [];
    if (command.type === 'revise') {
      task.goal = command.goal.trim();
      delete memory.follow;
    }
    task.status =
      command.type === 'pause'
        ? 'paused'
        : command.type === 'cancel'
          ? 'cancelled'
          : 'running';
    task.reason =
      command.type === 'pause'
        ? '已由玩家暂停，进度保留。'
        : command.type === 'cancel'
          ? '已由玩家取消。'
          : '';
    if (command.type === 'cancel') {
      delete memory.follow;
      delete memory.unfinishedBuild;
    }
    if (command.type === 'resume' || command.type === 'revise') {
      memory.failures = 0;
      memory.noProgress = 0;
      delete memory.waitSignature;
    }
    return task;
  }

  async commit(
    command: TaskCommand,
    authority: TaskAuthority,
    config: AgentConfig,
    save: () => Promise<void>,
    budget?: RequestBudget,
    beforeNewTask?: (task: AgentTask, previous: AgentRunState) => Promise<void>,
  ) {
    const before = structuredClone(this.memory);
    // Policy errors leave state unchanged and may be explained by the conversation.
    const task = this.command(command, authority, config);
    try {
      budget?.attach(task);
      if (command.type === 'start') await beforeNewTask?.(task, before);
      await save();
      return task;
    } catch {
      const usage = this.memory.usage;
      for (const key of Object.keys(this.memory))
        delete (this.memory as Record<string, unknown>)[key];
      Object.assign(this.memory, before, { usage });
      throw new AgentRuntimeError('无法保存任务检查点，已停止写操作。', true);
    }
  }

  finish(lease: TaskLease, outcome: TaskOutcome, turnMutated = false) {
    this.assertCurrent(lease);
    const memory = this.memory;
    if (
      outcome.status === 'completed' &&
      (turnMutated ||
        memory.pendingEffects ||
        memory.unfinishedBuild ||
        memory.follow ||
        memory.unknownEffect ||
        (memory.previous && !(memory.previous as { ok?: boolean }).ok))
    )
      throw new AgentRuntimeError(
        '当前仍有未确认或失败动作，先读取结果或重新观察，再确认完成。',
      );
    const task = memory.task!;
    task.status = outcome.status;
    task.summary = outcome.reason;
    task.reason = outcome.reason;
    task.waitFor = outcome.status === 'waiting' ? outcome.waitFor : undefined;
    if (outcome.status === 'waiting') memory.waitSignature = outcome.signature;
    if (outcome.status === 'completed') delete memory.pi;
  }
}

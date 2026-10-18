import type { AgentTask, AgentUsage } from '@voxel/shared';
import type { AgentConfig } from '../contracts';
import { AgentRuntimeError } from '../errors';

export class BudgetExhausted extends AgentRuntimeError {
  constructor(message: string) {
    super(message, true);
  }
}

/** Counts actual provider requests, never scheduler wakes or tool calls. */
export class RequestBudget {
  readonly usage: AgentUsage = { calls: 0, tokens: 0, estimated: false };
  readonly started = Date.now();
  private attached?: AgentTask;
  private elapsedCharged = 0;
  constructor(
    readonly config: AgentConfig,
    readonly total: AgentUsage,
    task?: AgentTask,
  ) {
    this.attached = task;
  }
  get remainingMs() {
    return (
      (this.config.taskTimeoutMs ?? 900000) -
      (this.attached?.elapsedMs ?? this.elapsedCharged) -
      (Date.now() - this.started - this.elapsedCharged)
    );
  }
  check() {
    const scope = this.attached ?? this.usage;
    const reason =
      scope.calls >= this.config.maxTurns
        ? '已达到任务调用上限，请检查进展后手动继续。'
        : scope.tokens >= (this.config.tokenBudget ?? 50000)
          ? '已达到任务 token 预算，请检查进展后手动继续。'
          : this.remainingMs <= 0
            ? '已达到任务执行时间上限，请检查进展后手动继续。'
            : '';
    if (reason) throw new BudgetExhausted(reason);
  }
  begin() {
    this.check();
    this.usage.calls++;
    this.total.calls++;
    if (this.attached) this.attached.calls++;
    return Math.max(
      1,
      Math.min(
        this.config.maxTokens,
        (this.config.tokenBudget ?? 50000) -
          (this.attached ?? this.usage).tokens,
      ),
    );
  }
  finish(tokens: number, estimated: boolean) {
    tokens =
      Number.isFinite(tokens) && tokens >= 0
        ? Math.ceil(tokens)
        : this.config.maxTokens;
    for (const scope of [
      this.usage,
      this.total,
      ...(this.attached ? [this.attached] : []),
    ]) {
      scope.tokens += tokens;
      scope.estimated ||= estimated;
    }
  }
  attach(task: AgentTask) {
    if (this.attached === task) return;
    if (this.attached)
      throw new AgentRuntimeError('不能在同一次运行中重新分配任务预算。', true);
    this.attached = task;
    task.elapsedMs += this.elapsedCharged;
    task.calls += this.usage.calls;
    task.tokens += this.usage.tokens;
    task.estimated ||= this.usage.estimated;
  }
  flushTime() {
    const elapsed = Date.now() - this.started;
    if (this.attached) this.attached.elapsedMs += elapsed - this.elapsedCharged;
    this.elapsedCharged = elapsed;
  }
}

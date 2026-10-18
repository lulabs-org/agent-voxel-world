import type { AgentTask } from '@voxel/shared';
import type {
  AgentConfig,
  TaskDirective,
  BatchResult,
  Observation,
} from '../contracts';
import { AgentRuntimeError } from '../errors';
import { newTask, type AgentRunState } from './state';
import type { RequestBudget } from './budget';
import { worldSignature, type DecisionContext } from './observation';

/** Task ownership and budget assignment. World effects belong to execute-step. */
export async function prepareTaskTransition({
  directive: d,
  prepared,
  memory,
  config,
  budget,
  beforeNewTask,
  sendControlReply,
  notifySender,
}: {
  directive: TaskDirective;
  prepared: DecisionContext;
  memory: AgentRunState;
  config: AgentConfig;
  budget: RequestBudget;
  beforeNewTask?: (task: AgentTask) => Promise<void>;
  sendControlReply: (text: string) => Promise<void>;
  notifySender: (text: string) => Promise<void>;
}) {
  let { task } = prepared;
  const { addressed, visibleTask, privateTo } = prepared;
  let chargedTask = !addressed ? task : undefined;
  // Some providers repeat the existing task as "task" or "update" on polls.
  // Only normalize the same goal, retaining identity, audience and all budgets.
  if (
    !addressed &&
    task &&
    (d.intent === 'task' || d.intent === 'update') &&
    (!d.goal || d.goal === task.goal)
  )
    d.intent = 'continue';
  if (!addressed && d.intent !== 'continue')
    throw new AgentRuntimeError(
      '自动推进必须使用 intent=continue，不能创建或替换任务目标。',
    );
  if (addressed && d.intent === 'continue')
    throw new AgentRuntimeError(
      '处理新消息时必须区分 reply、task、update 或任务控制，不能使用 continue。',
    );
  if (d.intent !== 'reply') {
    if (
      addressed &&
      task &&
      !['completed', 'cancelled'].includes(task.status) &&
      ((task.owner && task.owner !== addressed.actor) ||
        (task.privateTo && task.privateTo !== privateTo))
    ) {
      await sendControlReply(
        '我还有正在处理的任务，请由任务发起者修改或取消，或在控制台安排新任务。',
      );
      memory.lastResponse = '保留原任务：仅任务发起者可修改或取消。';
      throw new AgentRuntimeError(memory.lastResponse);
    }
    if (d.intent === 'task') {
      const nextTask = newTask(d.goal!, addressed!.actor, privateTo);
      await beforeNewTask?.(nextTask);
      task = memory.task = nextTask;
      memory.previous = undefined;
      memory.pendingEffects = undefined;
      memory.unfinishedBuild = undefined;
      memory.noProgress = 0;
      memory.failures = 0;
      memory.lastProgress = undefined;
    } else if (!task || !visibleTask)
      throw new AgentRuntimeError(
        '没有可修改的任务，请使用 task 创建明确的新任务。',
      );
    if (d.intent === 'task' || d.intent === 'update' || d.intent === 'cancel')
      delete memory.follow;
    if (d.intent === 'update' && d.goal) task!.goal = d.goal;
    chargedTask = task;
    budget.attach(task!);
    if (
      d.intent === 'resume' &&
      ['completed', 'cancelled', 'budget'].includes(task!.status)
    ) {
      // Budget extensions are operator-controlled, never reset by a chat loop.
      await sendControlReply(
        '这个任务已结束或达到预算，请在控制台确认后继续或布置新任务。',
      );
      return { task, chargedTask, stopped: true };
    }
    if (!['pause', 'cancel'].includes(d.intent)) {
      const reason =
        task!.calls > config.maxTurns
          ? '已达到任务调用上限。'
          : task!.tokens >= (config.tokenBudget ?? 50000)
            ? '已达到任务 token 预算。'
            : budget.remainingMs <= 0
              ? '任务执行时间预算已耗尽。'
              : '';
      if (reason) {
        task!.status = 'budget';
        task!.reason = reason;
        await notifySender(reason);
        return { task, chargedTask, stopped: true };
      }
    }
  }
  return { task, chargedTask, stopped: false };
}

/** Commit task status only after action results and a fresh observation are available. */
export function completeTaskTransition(
  task: AgentTask,
  d: TaskDirective,
  memory: AgentRunState,
  batch: BatchResult,
  finalObservation: Observation,
  quiet: boolean,
) {
  task.summary = d.summary;
  task.reason = d.status === 'running' ? '' : d.summary;
  task.status =
    d.intent === 'pause'
      ? 'paused'
      : d.intent === 'cancel'
        ? 'cancelled'
        : d.status;
  task.waitFor = 'waitFor' in d ? d.waitFor : undefined;
  const acted = batch.results.filter((r) => r.status !== 'pending');
  const mutated = acted.some((r) =>
    ['edit', 'build', 'house', 'move', 'goto', 'follow'].includes(
      r.action.type,
    ),
  );
  if (
    (mutated && task.status === 'completed') ||
    (acted.some((r) => r.action.type === 'move') && task.status === 'waiting')
  ) {
    task.status = 'running';
    task.reason = '等待下一次观察验证执行结果。';
    task.waitFor = undefined;
  }
  if (!batch.ok && !['paused', 'cancelled'].includes(task.status)) {
    task.status = 'running';
    task.reason = `批次中断：${batch.stopReason}，根据最新观察重新规划。`;
    task.waitFor = undefined;
  }
  if (task.status === 'completed' && memory.unfinishedBuild) {
    task.status = 'blocked';
    task.reason = '仍有未完成的建造方块，不能标记完成。';
  }
  if (task.status === 'cancelled') {
    memory.unfinishedBuild = undefined;
    delete memory.follow;
  }
  if (memory.follow && task.status === 'completed') {
    task.status = 'blocked';
    task.reason = '持续跟随尚未取消或替换，不能标记完成。';
  }
  if (
    memory.follow &&
    batch.ok &&
    ['running', 'waiting'].includes(task.status)
  ) {
    task.status = 'waiting';
    task.waitFor = 'players';
    task.summary = '持续跟随中，由本地导航控制器推进。';
  }
  const progress = JSON.stringify([
    finalObservation.self.x,
    finalObservation.self.y,
    finalObservation.self.z,
    worldSignature(finalObservation, 'world'),
  ]);
  const advanced = batch.results.some(
    (r) =>
      (r.action.type === 'edit' && r.result?.ok) ||
      (r.result && 'completed' in r.result && r.result.completed > 0) ||
      (r.before &&
        r.after &&
        Math.hypot(
          r.after.x - r.before.x,
          r.after.y - r.before.y,
          r.after.z - r.before.z,
        ) >= 0.05),
  );
  if (!quiet && batch.stopReason !== 'message') {
    memory.noProgress =
      !advanced && (!batch.ok || progress === memory.lastProgress)
        ? (memory.noProgress ?? 0) + 1
        : 0;
    memory.lastProgress = progress;
  }
  if (!quiet && (memory.noProgress ?? 0) >= 3 && task.status === 'running') {
    task.status = 'blocked';
    task.reason = '连续三次失败或没有实际进展，已停止自动重试。';
  }
  if (task.status === 'waiting')
    memory.waitSignature = worldSignature(finalObservation, task.waitFor);
}

/** Additional guards for sequential tools before any task transition/effect. */
export function validateToolDirective(
  next: TaskDirective,
  memory: AgentRunState,
  {
    addressed,
    taskMode,
    turnMutated,
  }: { addressed: boolean; taskMode: boolean; turnMutated: boolean },
) {
  if (!addressed && next.intent !== 'continue')
    throw new AgentRuntimeError('自动推进只能继续当前任务。');
  if (taskMode && addressed && next.intent === 'task')
    throw new AgentRuntimeError(
      '当前任务已建立，请继续；不能重复创建任务重置预算。',
    );
  if (
    next.status === 'completed' &&
    next.intent !== 'reply' &&
    (turnMutated ||
      memory.pendingEffects ||
      memory.unfinishedBuild ||
      memory.follow ||
      (memory.previous && !(memory.previous as { ok?: boolean }).ok))
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
}

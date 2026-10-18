import type { ManagedAgentView } from '@voxel/shared';
import { taskStatusNames } from '../model';

export function taskPresentation(job: ManagedAgentView) {
  const task = job.task;
  if (!task) return undefined;
  const resources = [
    {
      id: 'calls',
      label: '模型调用',
      used: task.calls,
      limit: job.maxTurns,
      unit: '次',
      estimated: false,
    },
    {
      id: 'tokens',
      label: 'Token 用量',
      used: task.tokens,
      limit: job.tokenBudget ?? 50000,
      unit: 'tokens',
      estimated: task.estimated,
    },
    {
      id: 'time',
      label: '有效执行时间',
      used: task.elapsedMs,
      limit: job.taskTimeoutMs ?? 900000,
      unit: '',
      estimated: false,
    },
  ].map((resource) => ({
    ...resource,
    exhausted: resource.used >= resource.limit,
  }));
  const exhausted = resources.filter((resource) => resource.exhausted);
  const budgetReason = exhausted
    .map(
      ({ id }) =>
        ({
          calls: '调用次数用尽',
          tokens: 'token 预算耗尽',
          time: '执行时间用尽',
        })[id],
    )
    .join('、');
  const status =
    task.status === 'budget'
      ? `已暂停 · ${budgetReason || '达到执行上限'}`
      : task.status === 'cancelled'
        ? '已结束'
        : taskStatusNames[task.status];
  const defaults = {
    running: '正在推进任务。',
    waiting: '正在等待环境变化，条件未变化时不调用模型。',
    needs_input: '需要补充任务说明后才能继续。',
    blocked: '当前无法继续，请检查运行记录或修改任务。',
    paused: '任务已暂停，确认后可继续。',
    completed: 'Agent 已标记任务完成，可检查结果或安排新任务。',
    cancelled: '任务已结束，已发生的世界改动保留。',
    budget: '本轮执行额度已用尽，调整额度后可继续。',
  };
  const interrupted =
    job.status === 'failed' &&
    !['completed', 'cancelled', 'budget'].includes(task.status);
  const offline =
    !job.sessionId && ['running', 'waiting'].includes(task.status);
  const transitioning = job.status === 'joining' || job.status === 'stopping';
  return {
    status: transitioning
      ? job.status === 'joining'
        ? '正在加入世界'
        : '正在离开世界'
      : interrupted
        ? '执行中断'
        : offline
          ? '未在世界中 · 任务未执行'
          : status,
    reason: transitioning
      ? '正在切换连接状态，请稍候。'
      : interrupted
        ? '执行或连接发生错误，请查看运行记录后再决定是否继续。'
        : offline
          ? '角色当前离线，加入世界并继续任务后才会执行。'
          : task.reason || defaults[task.status],
    resources,
    attention:
      interrupted || ['budget', 'blocked', 'needs_input'].includes(task.status),
    reasonLabel: ['paused', 'budget'].includes(task.status)
      ? '暂停原因'
      : task.status === 'blocked'
        ? '受阻原因'
        : '状态说明',
  };
}
export function taskDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分${seconds % 60 ? ` ${seconds % 60} 秒` : ''}`;
}

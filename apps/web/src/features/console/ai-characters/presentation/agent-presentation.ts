import type { AICharacterView } from '@voxel/shared';
import { taskStatusNames } from '../../execution-status';

/** Presence and task execution are separate: an idle process can have a running task. */
export function aiCharacterPresentation(job: AICharacterView) {
  const transitioning = ['joining', 'stopping'].includes(job.status);
  const online = !!job.sessionId;
  const occupiesSlot = online || transitioning || job.status === 'running';
  const executing =
    online &&
    (job.status === 'running' ||
      ['running', 'waiting'].includes(job.task?.status ?? ''));
  const ended =
    !!job.task && ['completed', 'cancelled'].includes(job.task.status);
  const attention =
    job.status === 'failed' ||
    (!!job.task &&
      ['needs_input', 'blocked', 'budget'].includes(job.task.status));
  return {
    online,
    occupiesSlot,
    transitioning,
    executing,
    ended,
    attention,
    presence:
      job.status === 'joining'
        ? '正在加入'
        : job.status === 'stopping'
          ? '正在离开'
          : online
            ? '在世界中'
            : '未在世界中',
    taskLabel: job.task ? taskStatusNames[job.task.status] : '等待安排任务',
    canEdit: !transitioning && !executing && job.status !== 'running',
  };
}

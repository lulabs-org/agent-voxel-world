import type { AICharacterSummary } from '@voxel/shared';
import i18n from '../../../../i18n/config';
import { taskStatusNames } from '../../execution-status';

/** Presence and task execution are separate: an idle process can have a running task. */
export function aiCharacterPresentation(job: AICharacterSummary) {
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
        ? i18n.t('console.characters.presenceJoining')
        : job.status === 'stopping'
          ? i18n.t('console.characters.presenceLeaving')
          : online
            ? i18n.t('console.characters.presenceInWorld')
            : i18n.t('console.characters.presenceNotInWorld'),
    taskLabel: job.task
      ? taskStatusNames[job.task.status]
      : i18n.t('console.characters.waitingTask'),
    canEdit: !transitioning && !executing && job.status !== 'running',
  };
}

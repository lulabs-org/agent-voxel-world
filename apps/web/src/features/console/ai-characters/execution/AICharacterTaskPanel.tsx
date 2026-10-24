import type { AICharacterSummary } from '@voxel/shared';
import { useI18n } from '../../../../i18n/context';
import { CurrentTaskBudget } from '../execution/CurrentTaskBudget';

export function AICharacterTaskPanel({
  job,
  disabled,
  onUpdated,
}: {
  job: AICharacterSummary;
  disabled: boolean;
  onUpdated: () => Promise<void>;
}) {
  const { t } = useI18n();
  const hasCurrentTask = !!job.taskExecution && !!job.task;
  const hasQueuedTasks = !!job.queuedTasks?.length;

  return (
    <section
      className="agents-activity"
      aria-label={t('console.characters.tabTask')}
    >
      {hasCurrentTask && (
        <CurrentTaskBudget
          key={job.taskExecution?.runId}
          job={job}
          disabled={disabled}
          onUpdated={onUpdated}
        />
      )}
      {hasQueuedTasks && (
        <section
          className="agents-task-queue"
          aria-label={t('console.characters.queuedTasksTitle')}
        >
          <div className="agents-task-queue-heading">
            <h4>{t('console.characters.queuedTasksTitle')}</h4>
            <span>{job.queuedTasks?.length}</span>
          </div>
          <ol>
            {job.queuedTasks?.map((run) => (
              <li key={run.id}>
                {t('console.characters.queuedItem', {
                  goal: run.goal,
                  count: run.coalescedTriggers,
                })}
              </li>
            ))}
          </ol>
          <p className="agent-hint">{t('console.characters.queuedHint')}</p>
        </section>
      )}
      {!hasCurrentTask && !hasQueuedTasks && (
        <p className="agents-task-empty">
          {t('console.characters.noCurrentTask')}
        </p>
      )}
    </section>
  );
}

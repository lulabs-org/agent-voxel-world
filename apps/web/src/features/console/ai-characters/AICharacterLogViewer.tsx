import { AI_CHARACTER_LOG_LIMIT, type AICharacterView } from '@voxel/shared';
import { useI18n } from '../../../i18n/context';
import { CurrentTaskBudget } from './CurrentTaskBudget';

export function AICharacterLogViewer({
  job,
  disabled,
  onUpdated,
}: {
  job: AICharacterView;
  disabled: boolean;
  onUpdated: () => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <section
      className="agents-activity"
      aria-label={t('console.characters.tabActivity')}
    >
      <CurrentTaskBudget
        key={job.taskExecution?.runId ?? 'none'}
        job={job}
        disabled={disabled}
        onUpdated={onUpdated}
      />
      {!!job.queuedTasks?.length && (
        <section
          className="agents-progress"
          aria-label={t('console.characters.queuedTasksTitle')}
        >
          <h4>{t('console.characters.queuedTasksTitle')}</h4>
          <ol>
            {job.queuedTasks.map((run) => (
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
      {job.lastResponse && (
        <div className="agents-progress">
          <span className="agents-section-label">
            {t('console.characters.lastReplyTitle')}
          </span>
          <p>{job.lastResponse}</p>
        </div>
      )}
      <div className="agents-task-heading">
        <h4>{t('console.characters.activityLogsHeading')}</h4>
        <span className="agent-hint">
          {t('console.characters.activityLogsLimit', {
            limit: AI_CHARACTER_LOG_LIMIT,
          })}
        </span>
      </div>
      {job.logs.length ? (
        <ol className="agents-log-list">
          {[...job.logs].reverse().map((message, index) => {
            const timestamp = job.logTimes?.[job.logs.length - index - 1];
            const date =
              typeof timestamp === 'number' ? new Date(timestamp) : undefined;
            const valid = date && Number.isFinite(date.getTime());
            return (
              <li key={`${job.logs.length - index}-${message}`}>
                {valid ? (
                  <time
                    dateTime={date.toISOString()}
                    title={date.toISOString()}
                  >
                    {date.toLocaleString('zh-CN', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                    })}
                  </time>
                ) : (
                  <span className="agents-log-time">
                    {t('console.characters.timeNotRecorded')}
                  </span>
                )}
                <span>{message}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="agents-list-empty">
          {t('console.characters.noActivityLogs')}
        </p>
      )}
    </section>
  );
}

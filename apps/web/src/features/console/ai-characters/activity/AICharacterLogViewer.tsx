import { AI_CHARACTER_LOG_LIMIT, type AICharacterSummary } from '@voxel/shared';
import { useI18n } from '../../../../i18n/context';
import { useAICharacterLogs } from './useAICharacterLogs';

export function AICharacterLogViewer({ job }: { job: AICharacterSummary }) {
  const { t } = useI18n();
  const {
    entries,
    nextCursor,
    total,
    loading,
    loadingMore,
    loadMoreError,
    error,
    loadFirstPage,
    loadMore,
  } = useAICharacterLogs(job.id);
  return (
    <section
      className="agents-activity"
      aria-label={t('console.characters.tabActivity')}
    >
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
        <button
          type="button"
          className="agents-log-refresh"
          onClick={() => void loadFirstPage()}
          disabled={loading}
        >
          {t('console.characters.logsRefresh')}
        </button>
      </div>
      <p className="agent-hint">
        {t('console.characters.activityLogsLimit', {
          limit: AI_CHARACTER_LOG_LIMIT,
        })}
      </p>
      {loading ? (
        <p className="agents-list-empty">
          {t('console.characters.logsLoading')}
        </p>
      ) : error && !entries.length ? (
        <p className="agents-list-empty" role="alert">
          {error}
        </p>
      ) : entries.length ? (
        <>
          <ol
            className="agents-log-list"
            tabIndex={0}
            aria-label={t('console.characters.activityLogsHeading')}
            onScroll={(event) => {
              if (error || loadMoreError) return;
              const list = event.currentTarget;
              if (list.scrollHeight - list.scrollTop - list.clientHeight <= 80)
                void loadMore();
            }}
          >
            {entries.map((entry, index) => {
              const date =
                typeof entry.time === 'number'
                  ? new Date(entry.time)
                  : undefined;
              const valid = date && Number.isFinite(date.getTime());
              return (
                <li key={`${index}-${entry.text}`}>
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
                  <span>{entry.text}</span>
                </li>
              );
            })}
          </ol>
          {nextCursor &&
            (loadMoreError ? (
              <div className="agents-log-load-status" role="alert">
                <span>{t('console.characters.logsLoadFailed')}</span>
                <button type="button" onClick={() => void loadMore()}>
                  {t('console.characters.logsRetry')}
                </button>
              </div>
            ) : (
              <p className="agents-log-load-status" role="status">
                {loadingMore
                  ? t('console.characters.logsLoadingMore')
                  : t('console.characters.logsScrollMore', {
                      remaining: Math.max(total - entries.length, 0),
                    })}
              </p>
            ))}
        </>
      ) : (
        <p className="agents-list-empty">
          {t('console.characters.noActivityLogs')}
        </p>
      )}
      {error && !!entries.length && (
        <p className="agent-hint" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

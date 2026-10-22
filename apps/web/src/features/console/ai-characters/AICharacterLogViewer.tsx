import {
  AI_CHARACTER_LOG_LIMIT,
  type AICharacterLogEntry,
  type AICharacterSummary,
} from '@voxel/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../i18n/context';
import { CurrentTaskBudget } from './CurrentTaskBudget';
import { aiCharactersApi } from './api';

export function AICharacterLogViewer({
  job,
  disabled,
  onUpdated,
}: {
  job: AICharacterSummary;
  disabled: boolean;
  onUpdated: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<AICharacterLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const loadFirstPage = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const page = await aiCharactersApi.getLogs(job.id);
      if (id !== requestId.current) return;
      setEntries(page.entries);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
    } catch {
      if (id === requestId.current)
        setError(t('console.characters.logsLoadFailed'));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [job.id, t]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const page = await aiCharactersApi.getLogs(job.id, nextCursor);
      if (id !== requestId.current) return;
      setEntries((list) => [...list, ...page.entries]);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
    } catch {
      setError(t('console.characters.logsLoadFailed'));
    } finally {
      setLoadingMore(false);
    }
  };

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
          <ol className="agents-log-list">
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
          {nextCursor && (
            <button
              type="button"
              className="agents-log-more"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore
                ? t('console.characters.logsLoading')
                : t('console.characters.logsLoadMore', {
                    remaining: Math.max(total - entries.length, 0),
                  })}
            </button>
          )}
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

import type { AICharacterSummary, TaskLimits } from '@voxel/shared';
import { useState } from 'react';
import { useI18n } from '../../../i18n/context';
import { displayedTaskIdentity, controlTaskRun } from '../execution/api';
import { TaskBudgetFields } from '../execution/TaskBudgetFields';

export function CurrentTaskBudget({
  job,
  disabled,
  onUpdated,
}: {
  job: AICharacterSummary;
  disabled: boolean;
  onUpdated: () => Promise<void>;
}) {
  const { t } = useI18n();
  const execution = job.taskExecution;
  const task = job.task;
  const [draft, setDraft] = useState<{
    limits: TaskLimits;
    expectedTask: ReturnType<typeof displayedTaskIdentity>;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!execution || !task) return null;
  const limited = execution.limits.enabled !== false;
  const resumable = [
    'budget',
    'paused',
    'needs_input',
    'blocked',
    'failed',
  ].includes(task.status);
  const offline =
    !job.sessionId ||
    ['stopped', 'stopping', 'joining', 'failed'].includes(job.status);
  const blocked = disabled || busy || offline || !!job.taskRequiresReassignment;
  const control = async (operation: 'pause' | 'cancel') => {
    setBusy(true);
    setError('');
    try {
      await controlTaskRun(
        execution.runId,
        operation,
        {},
        displayedTaskIdentity(job),
      );
      setDraft(undefined);
      await onUpdated();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('console.characters.operationFailed'),
      );
    } finally {
      setBusy(false);
    }
  };
  const sourceLabel =
    execution.source === 'chat'
      ? t('console.characters.taskSourceChat')
      : execution.source === 'scheduled'
        ? t('console.characters.taskSourceScheduled')
        : t('console.characters.taskSourceManual');

  return (
    <section
      className="agents-progress"
      aria-label={t('console.characters.currentTaskAria')}
    >
      <h4>{t('console.characters.currentTaskGoal', { goal: task.goal })}</h4>
      <p className="agent-hint">
        {t('console.characters.taskSource', { source: sourceLabel })}
        {execution.action
          ? ` · ${execution.action.name} (${execution.action.status})`
          : ''}
      </p>
      {task.reason && <p role="status">{task.reason}</p>}
      <dl className="plans-run-stats task-run-usage">
        <div>
          <dt>{t('console.characters.statTurns')}</dt>
          <dd>
            {t('console.characters.turnsValue', {
              calls: task.calls,
              limit: limited
                ? execution.limits.maxTurns
                : t('console.characters.unlimited'),
            })}
          </dd>
        </div>
        <div>
          <dt>
            {t('console.characters.statTokens', {
              estimated: task.estimated
                ? t('console.characters.statEstimatedTag')
                : '',
            })}
          </dt>
          <dd>
            {task.tokens.toLocaleString()} /{' '}
            {limited
              ? execution.limits.tokenBudget.toLocaleString()
              : t('console.characters.unlimited')}
          </dd>
        </div>
        <div>
          <dt>{t('console.characters.statDuration')}</dt>
          <dd>
            {t('console.characters.durationValue', {
              elapsed: Math.round(task.elapsedMs / 1000),
              limit: limited
                ? t('console.characters.minutesUnit', {
                    min: execution.limits.taskTimeoutMs / 60000,
                  })
                : t('console.characters.unlimited'),
            })}
          </dd>
        </div>
      </dl>
      <p className="agent-hint">{t('console.characters.currentBudgetHint')}</p>
      {!['completed', 'cancelled'].includes(task.status) && (
        <div className="agents-actions">
          {['running', 'waiting'].includes(task.status) && (
            <button
              disabled={disabled || busy || offline}
              onClick={() => void control('pause')}
            >
              {t('console.characters.pauseCurrentTask')}
            </button>
          )}
          <button
            disabled={disabled || busy || offline}
            onClick={() => void control('cancel')}
          >
            {t('console.characters.cancelCurrentTask')}
          </button>
        </div>
      )}
      {resumable && !draft && (
        <button
          disabled={blocked}
          onClick={() => {
            setError('');
            setDraft({
              limits: { ...execution.limits },
              expectedTask: displayedTaskIdentity(job),
            });
          }}
        >
          {limited
            ? t('console.characters.adjustBudgetAndResume')
            : t('console.characters.resumeCurrentTask')}
        </button>
      )}
      {resumable && offline && (
        <p className="agent-hint">
          {t('console.characters.offlineResumeHint')}
        </p>
      )}
      {job.taskRequiresReassignment && (
        <p className="agent-error">
          {t('console.characters.staleChatSessionError')}
        </p>
      )}
      {draft && resumable && (
        <form
          className="agent-form agents-confirm"
          onSubmit={(event) => {
            void (async () => {
              event.preventDefault();
              const limits = draft.limits;
              if (
                limited &&
                (limits.maxTurns <= task.calls ||
                  limits.tokenBudget <= task.tokens ||
                  limits.taskTimeoutMs <= task.elapsedMs)
              ) {
                setError(t('console.characters.budgetLowerThanUsedError'));
                return;
              }
              setBusy(true);
              setError('');
              try {
                await controlTaskRun(
                  execution.runId,
                  'resume',
                  { ...limits },
                  draft.expectedTask,
                );
                setDraft(undefined);
                await onUpdated();
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : t('console.characters.resumeFailed'),
                );
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <p>{t('console.characters.resumePrompt')}</p>
          <fieldset disabled={blocked}>
            {limited && (
              <TaskBudgetFields
                value={draft.limits}
                onChange={(value) =>
                  setDraft({ ...draft, limits: { ...draft.limits, ...value } })
                }
              />
            )}
            <div className="agents-actions">
              <button className="primary">
                {t('console.characters.confirmAndResume')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(undefined);
                  setError('');
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {error && (
        <p className="agent-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

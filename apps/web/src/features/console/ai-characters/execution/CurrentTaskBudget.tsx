import { useCurrentTaskBudget } from './useCurrentTaskBudget';
import { ConsoleFeedbackRelay } from '../../../../components/ui/ConsoleFeedbackRelay';
import type { AICharacterSummary } from '@voxel/shared';
import { useI18n } from '../../../../i18n/context';
import { taskStatusNames } from '../../execution-status';
import { TaskBudgetFields } from '../../execution/TaskBudgetFields';

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
  const {
    draft,
    busy,
    error,
    control,
    resume,
    beginResume,
    cancelResume,
    updateLimits,
  } = useCurrentTaskBudget(job, onUpdated);
  if (!execution || !task) return null;
  const limited = execution.limits.enabled !== false;
  const resumable = [
    'budget',
    'paused',
    'needs_input',
    'blocked',
    'failed',
  ].includes(task.status);
  const canControl = !['completed', 'cancelled'].includes(task.status);
  const offline =
    !job.sessionId ||
    ['stopped', 'stopping', 'joining', 'failed'].includes(job.status);
  const blocked = disabled || busy || offline || !!job.taskRequiresReassignment;
  const sourceLabel =
    execution.source === 'chat'
      ? t('console.characters.taskSourceChat')
      : execution.source === 'scheduled'
        ? t('console.characters.taskSourceScheduled')
        : t('console.characters.taskSourceManual');
  const metrics = [
    {
      key: 'calls',
      label: t('console.characters.statTurns'),
      value: t('console.characters.turnsValue', {
        calls: task.calls,
        limit: limited
          ? execution.limits.maxTurns
          : t('console.characters.unlimited'),
      }),
      used: task.calls,
      limit: execution.limits.maxTurns,
    },
    {
      key: 'tokens',
      label: t('console.characters.statTokens', {
        estimated: task.estimated
          ? t('console.characters.statEstimatedTag')
          : '',
      }),
      value: `${task.tokens.toLocaleString()} / ${limited ? execution.limits.tokenBudget.toLocaleString() : t('console.characters.unlimited')}`,
      used: task.tokens,
      limit: execution.limits.tokenBudget,
    },
    {
      key: 'duration',
      label: t('console.characters.statDuration'),
      value: t('console.characters.durationValue', {
        elapsed: Math.round(task.elapsedMs / 1000),
        limit: limited
          ? t('console.characters.minutesUnit', {
              min: execution.limits.taskTimeoutMs / 60000,
            })
          : t('console.characters.unlimited'),
      }),
      used: task.elapsedMs,
      limit: execution.limits.taskTimeoutMs,
    },
  ];

  return (
    <section
      className="agents-current-task"
      aria-label={t('console.characters.currentTaskAria')}
    >
      <div className="agents-current-task-header">
        <div className="agents-current-task-heading">
          <h4>
            {t('console.characters.currentTaskGoal', { goal: task.goal })}
          </h4>
          <p className="agent-hint">
            {t('console.characters.taskSource', { source: sourceLabel })}
            {execution.action
              ? ` · ${execution.action.name} (${execution.action.status})`
              : ''}
          </p>
        </div>
        <span className="agents-task-status" data-status={task.status}>
          {taskStatusNames[task.status]}
        </span>
      </div>
      {job.taskRequiresReassignment ? (
        <p className="agent-error agents-task-alert" role="alert">
          {t('console.characters.staleChatSessionError')}
        </p>
      ) : (
        task.reason && (
          <p
            className="agents-task-reason"
            data-warning={['budget', 'blocked', 'needs_input'].includes(
              task.status,
            )}
            role="status"
          >
            {task.reason}
          </p>
        )
      )}
      <h5 className="agents-task-usage-heading">
        {t('console.characters.currentTaskUsageTitle')}
      </h5>
      <dl className="agents-task-metrics">
        {metrics.map((metric) => (
          <div
            key={metric.key}
            className="agents-task-metric"
            data-exhausted={limited && metric.used >= metric.limit}
          >
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
            {limited && (
              <progress
                max={Math.max(metric.limit, 1)}
                value={Math.min(metric.used, Math.max(metric.limit, 1))}
                aria-label={metric.label}
              />
            )}
          </div>
        ))}
      </dl>
      <p className="agent-hint agents-task-budget-hint">
        {t('console.characters.currentBudgetHint')}
      </p>
      {canControl && (
        <div className="agents-actions agents-task-actions">
          {resumable && !draft && !job.taskRequiresReassignment && (
            <button
              className="primary"
              disabled={blocked}
              onClick={beginResume}
            >
              {limited
                ? t('console.characters.adjustBudgetAndResume')
                : t('console.characters.resumeCurrentTask')}
            </button>
          )}
          {['running', 'waiting'].includes(task.status) && (
            <button
              disabled={disabled || busy || offline}
              onClick={() => void control('pause')}
            >
              {t('console.characters.pauseCurrentTask')}
            </button>
          )}
          <button
            className="agents-task-cancel"
            disabled={disabled || busy || offline}
            onClick={() => void control('cancel')}
          >
            {t('console.characters.cancelCurrentTask')}
          </button>
        </div>
      )}
      {resumable && offline && (
        <p className="agent-hint">
          {t('console.characters.offlineResumeHint')}
        </p>
      )}
      {draft && resumable && (
        <form
          className="agent-form agents-confirm"
          onSubmit={(event) => {
            event.preventDefault();
            void resume();
          }}
        >
          <p>{t('console.characters.resumePrompt')}</p>
          <fieldset disabled={blocked}>
            {limited && (
              <TaskBudgetFields value={draft.limits} onChange={updateLimits} />
            )}
            <div className="agents-actions">
              <button className="primary">
                {t('console.characters.confirmAndResume')}
              </button>
              <button type="button" onClick={cancelResume}>
                {t('common.cancel')}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <ConsoleFeedbackRelay error={error} />
    </section>
  );
}

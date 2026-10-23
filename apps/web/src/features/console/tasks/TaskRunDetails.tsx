import type { TaskLimits, TaskRun } from '@voxel/shared';
import { useState } from 'react';
import { useI18n } from '../../../i18n/context';
import { TaskActionList } from './TaskActionList';
import { TaskBudgetFields } from '../execution/TaskBudgetFields';
import {
  planTime,
  runEnded,
  runStatus,
} from './presentation/task-plan-presentation';

export function TaskRunDetails({
  run,
  planGoal,
  hideHeading = false,
  busy,
  blocked,
  onAction,
}: {
  run: TaskRun;
  planGoal: string;
  hideHeading?: boolean;
  busy: boolean;
  blocked: string;
  onAction: (
    run: TaskRun,
    op: 'pause' | 'resume' | 'cancel',
    limits?: TaskLimits,
  ) => Promise<void>;
}) {
  const { t } = useI18n();
  const [resume, setResume] = useState(false),
    [cancel, setCancel] = useState(false);
  const [limits, setLimits] = useState(run.snapshot.limits);
  const limited = run.snapshot.limits.enabled !== false;
  const queued = run.status === 'queued';
  const inheritedPending =
    !run.startedAt && run.snapshot.limitsMode === 'inherit';
  const active = ['running', 'waiting'].includes(run.status);
  const sourceLabel =
    run.source === 'scheduled'
      ? t('console.plans.runSourceTime')
      : run.source === 'legacy'
        ? t('console.plans.runSourceImport')
        : t('console.plans.runSourceManual');

  return (
    <section
      className="plans-run-card"
      aria-label={t('console.plans.runDetailAria')}
    >
      {!hideHeading && (
        <div className="plans-run-header">
          <span
            className="plans-run-status-badge"
            data-active={['running', 'waiting'].includes(run.status)}
            data-warn={['paused', 'budget', 'needs_input', 'blocked'].includes(
              run.status,
            )}
            data-error={['failed', 'missed'].includes(run.status)}
          >
            <span
              className="plans-presence-dot"
              data-state={
                ['running', 'waiting'].includes(run.status)
                  ? 'enabled'
                  : ['paused', 'budget', 'needs_input'].includes(run.status)
                    ? 'paused'
                    : 'completed'
              }
            />
            {runStatus[run.status] || run.status}
          </span>
          <span className="plans-run-time">
            {planTime(run.startedAt ?? run.scheduledAt, run.snapshot.timeZone)}{' '}
            · {run.snapshot.timeZone}
          </span>
        </div>
      )}
      <p className="plans-run-meta-line">
        {hideHeading
          ? t('console.plans.runHistoryInfo', {
              rev: run.planRevision ?? 1,
              source: sourceLabel,
            })
          : t('console.plans.runCharacterInfo', {
              character:
                run.characterName ?? t('console.characters.deletedTag'),
              rev: run.planRevision ?? 1,
              source: sourceLabel,
            })}
      </p>
      {run.snapshot.goal.trim() !== planGoal.trim() && (
        <div className="plans-run-goal-box">
          <strong>{t('console.plans.runCurrentGoal')}</strong>
          {run.snapshot.goal}
        </div>
      )}
      {run.reason && run.reason !== run.task?.summary && (
        <p className="plans-run-reason" role="status">
          {run.reason}
        </p>
      )}
      {run.requiresReassignment && (
        <p className="agent-error" role="alert">
          {t('console.characters.staleChatSessionError')}
        </p>
      )}
      <div className="plans-run-report-box">
        <span
          className="plans-run-report-label"
          title={t('console.plans.runReportTooltip')}
        >
          {t('console.plans.runAgentReport')}
        </span>
        <p>{run.task?.summary || t('console.plans.noReport')}</p>
      </div>
      <dl className="plans-run-stats">
        <div className="plans-run-stat">
          <dt>{t('console.characters.statTurns')}</dt>
          <dd>
            {run.task?.calls ?? 0} /{' '}
            {inheritedPending
              ? t('console.plans.determinedAtStart')
              : limited
                ? run.snapshot.limits.maxTurns
                : t('console.characters.unlimited')}
          </dd>
        </div>
        <div className="plans-run-stat">
          <dt>
            {t('console.characters.statTokens', {
              estimated: run.task?.estimated
                ? t('console.characters.statEstimatedTag')
                : '',
            })}
          </dt>
          <dd>
            {run.totalTokens.toLocaleString()} /{' '}
            {inheritedPending
              ? t('console.plans.determinedAtStart')
              : limited
                ? run.snapshot.limits.tokenBudget.toLocaleString()
                : t('console.characters.unlimited')}
          </dd>
        </div>
        <div className="plans-run-stat">
          <dt>{t('console.characters.statDuration')}</dt>
          <dd>
            {t('console.characters.durationValue', {
              elapsed: Math.round((run.task?.elapsedMs ?? 0) / 1000),
              limit: inheritedPending
                ? t('console.plans.determinedAtStart')
                : limited
                  ? t('console.characters.minutesUnit', {
                      min: run.snapshot.limits.taskTimeoutMs / 60000,
                    })
                  : t('console.characters.unlimited'),
            })}
          </dd>
        </div>
      </dl>
      {queued && (
        <p className="agent-hint">
          {t('console.plans.queuedWaitingMessage', {
            count: run.coalescedTriggers ?? 0,
          })}
        </p>
      )}
      <TaskActionList actions={run.actions} report={run.task?.summary} />
      {!runEnded(run) && (
        <div className="agents-actions task-detail-actions">
          {active ? (
            <button disabled={busy} onClick={() => void onAction(run, 'pause')}>
              {t('console.plans.pauseThisRun')}
            </button>
          ) : !queued ? (
            <button
              className="primary"
              disabled={busy || !!blocked || run.requiresReassignment}
              onClick={() => {
                setResume(true);
                setCancel(false);
                setLimits(run.snapshot.limits);
              }}
            >
              {t('console.plans.resumeThisRun')}
            </button>
          ) : null}
          <button
            disabled={busy}
            onClick={() => {
              setCancel(true);
              setResume(false);
            }}
          >
            {queued
              ? t('console.plans.cancelQueuedRun')
              : t('console.plans.endThisRun')}
          </button>
        </div>
      )}
      {!active && !runEnded(run) && blocked && (
        <p className="agent-hint">
          {t('console.plans.blockedCannotRun', { reason: blocked })}
        </p>
      )}
      {resume && (
        <form
          className="agent-form agents-confirm"
          onSubmit={(e) => {
            void (async () => {
              e.preventDefault();
              await onAction(run, 'resume', limits);
              setResume(false);
            })();
          }}
        >
          <p>{t('console.plans.resumeRunPrompt')}</p>
          {limited ? (
            <TaskBudgetFields
              value={limits}
              onChange={(v) => setLimits({ ...limits, ...v })}
            />
          ) : (
            <p className="agent-hint">{t('console.plans.resumeNoLimitNote')}</p>
          )}
          <div className="agents-actions task-detail-actions">
            <button className="primary" disabled={busy || !!blocked}>
              {t('console.characters.confirmAndResume')}
            </button>
            <button type="button" onClick={() => setResume(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
      {cancel && (
        <div className="agents-confirm">
          <p>{t('console.plans.endRunWarning')}</p>
          <div className="agents-actions task-detail-actions">
            <button
              disabled={busy}
              onClick={() => {
                void (async () => {
                  await onAction(run, 'cancel');
                  setCancel(false);
                })();
              }}
            >
              {t('console.plans.confirmEnd')}
            </button>
            <button onClick={() => setCancel(false)}>{t('common.back')}</button>
          </div>
        </div>
      )}
    </section>
  );
}

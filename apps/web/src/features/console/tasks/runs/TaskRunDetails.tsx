import type { TaskLimits, TaskRun } from '@voxel/shared';
import { useId, useRef, useState } from 'react';
import { Dialog } from '../../../../components/ui/Dialog';
import { Button } from '../../../../components/ui/Button';
import { useI18n } from '../../../../i18n/context';
import { TaskActionList } from './TaskActionList';
import {
  planTime,
  runEnded,
  runStatus,
} from '../presentation/plan-presentation';

export function TaskRunDetails({
  run,
  planGoal,
  planStatusText,
  hideHeading = false,
  busy,
  blocked,
  onAction,
}: {
  run: TaskRun;
  planGoal: string;
  planStatusText?: string;
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
  const [cancel, setCancel] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const endButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
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
      <div className="plans-run-context">
        {planStatusText && (
          <p className="plans-run-meta-line">{planStatusText}</p>
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
        {run.reason && run.reason !== run.task?.summary && (
          <p className="plans-run-reason" role="status">
            {run.reason}
          </p>
        )}
      </div>
      {run.snapshot.goal.trim() !== planGoal.trim() && (
        <div className="plans-run-goal-box">
          <strong>{t('console.plans.runCurrentGoal')}</strong>
          {run.snapshot.goal}
        </div>
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
      <TaskActionList
        actions={run.actions}
        report={run.task?.summary}
        timeZone={run.snapshot.timeZone}
      />
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
                setCancel(false);
                void onAction(run, 'resume');
              }}
            >
              {t('console.plans.resumeThisRun')}
            </button>
          ) : null}
          <button
            ref={endButton}
            disabled={busy}
            onClick={() => {
              setCancel(true);
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
      {cancel && (
        <Dialog
          open
          initialFocus={cancelButton}
          className="agents-delete-dialog"
          overlayStyle={{ zIndex: 401 }}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          aria-busy={busy}
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) setCancel(false);
          }}
          onKeyDown={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            endButton.current?.focus();
          }}
        >
          <h3 id={titleId}>
            {t(
              queued
                ? 'console.plans.cancelQueuedRun'
                : 'console.plans.endThisRun',
            )}
          </h3>
          <p id={descriptionId}>{t('console.plans.endRunWarning')}</p>
          <div className="agents-actions">
            <Button
              ref={cancelButton}
              disabled={busy}
              onClick={() => setCancel(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              className="agents-delete-button"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  await onAction(run, 'cancel');
                  setCancel(false);
                })();
              }}
            >
              {t('console.plans.confirmEnd')}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

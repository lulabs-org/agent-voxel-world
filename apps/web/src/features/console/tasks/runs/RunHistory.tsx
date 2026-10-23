import { useI18n } from '../../../../i18n/context';
import type { AICharacterSummary, TaskPlan, TaskRun } from '@voxel/shared';
import type { TaskPlansController } from '../useTaskPlans';
import { TaskRunDetails } from './TaskRunDetails';
import {
  runEnded,
  planTime,
  runStatus,
} from '../presentation/plan-presentation';
import { TaskPlanUsageCard } from '../detail/TaskPlanUsageCard';
export function RunHistory({
  plan,
  runs,
  characters,
  locked,
  runControl,
  nextRunPage,
  loadOlderRecords,
}: {
  plan: TaskPlan;
  runs: TaskRun[];
  characters: AICharacterSummary[];
  locked: boolean;
  runControl: TaskPlansController['runControl'];
  nextRunPage?: number;
  loadOlderRecords: () => void;
}) {
  const { t } = useI18n();
  return (
    <section aria-label={t('console.plans.historyHeading')}>
      <TaskPlanUsageCard plan={plan} />{' '}
      {!runs.some(runEnded) && (
        <p className="agent-hint" style={{ margin: '4px 0 16px' }}>
          {t('console.plans.noHistoryRuns')}
        </p>
      )}
      {runs.filter(runEnded).map((r) => (
        <details key={r.id} className="plans-history-card">
          <summary className="plans-history-summary">
            <span className="plans-history-summary-main">
              <strong>
                {planTime(r.startedAt ?? r.scheduledAt, r.snapshot.timeZone)}
              </strong>
              <span>
                {r.characterName}
                {!characters.some((a) => a.id === r.characterId)
                  ? t('console.plans.deletedTag')
                  : ''}
              </span>
            </span>
            <span className="plans-history-status" data-status={r.status}>
              {runStatus[r.status] || r.status}
            </span>
          </summary>
          <div className="plans-history-body">
            <TaskRunDetails
              run={r}
              planGoal={plan.goal}
              hideHeading
              busy={locked}
              blocked=""
              onAction={runControl}
            />
          </div>
        </details>
      ))}
      {nextRunPage !== undefined && (
        <div style={{ marginTop: 12 }}>
          <button disabled={locked} onClick={loadOlderRecords}>
            {t('console.plans.loadOlderRecords')}
          </button>
        </div>
      )}
    </section>
  );
}

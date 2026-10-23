import { useI18n } from '../../../../i18n/context';
import type { TaskPlan, TaskRun } from '@voxel/shared';
import type { TaskPlansController } from '../useTaskPlans';
import { TaskRunDetails } from './TaskRunDetails';
import { runEnded } from '../presentation/plan-presentation';
export function ActiveRuns({
  plan,
  runs,
  planStatusText,
  locked,
  blocked,
  runControl,
}: {
  plan: TaskPlan;
  runs: TaskRun[];
  planStatusText?: string;
  locked: boolean;
  blocked: string;
  runControl: TaskPlansController['runControl'];
}) {
  const { t } = useI18n();
  return (
    <section aria-label={t('console.plans.activeRuns')}>
      {!runs.some((r) => !runEnded(r)) && (
        <p className="agent-hint" style={{ margin: '4px 0 16px' }}>
          {planStatusText}
          <br />
          {t('console.plans.noActiveRuns')}
        </p>
      )}
      {runs
        .filter((r) => !runEnded(r))
        .map((r) => (
          <TaskRunDetails
            key={r.id}
            run={r}
            planGoal={plan.goal}
            planStatusText={planStatusText}
            busy={locked}
            blocked={blocked}
            onAction={runControl}
          />
        ))}
    </section>
  );
}

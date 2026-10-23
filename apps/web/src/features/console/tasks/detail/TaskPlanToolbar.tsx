import { useI18n } from '../../../../i18n/context';
import type { TaskPlan, TaskRun } from '@voxel/shared';
import type { TaskPlansController } from '../useTaskPlans';
import { runEnded } from '../presentation/plan-presentation';
export function TaskPlanToolbar({
  plan,
  runs,
  locked,
  blocked,
  control,
}: {
  plan: TaskPlan;
  runs: TaskRun[];
  locked: boolean;
  blocked: string;
  control: TaskPlansController['control'];
}) {
  const { t } = useI18n();
  return (
    <div className="plans-toolbar">
      <button
        type="button"
        disabled={locked || !!blocked || runs.some((r) => !runEnded(r))}
        onClick={() =>
          void control('run', {
            requestId: crypto.randomUUID(),
          })
        }
      >
        {t('console.plans.runNow')}
      </button>
      {plan.timing.kind !== 'immediate' && (
        <button
          type="button"
          disabled={locked || (!plan.characterId && plan.state !== 'enabled')}
          onClick={() =>
            void control(plan.state === 'enabled' ? 'pause' : 'resume')
          }
        >
          {plan.state === 'enabled'
            ? t('console.plans.pausePlan')
            : t('console.plans.enablePlan')}
        </button>
      )}
      <button
        type="button"
        disabled={
          locked || runs.some((r) => r.status !== 'queued' && !runEnded(r))
        }
        onClick={() => void control('archive')}
      >
        {t('console.plans.archivePlan')}
      </button>
    </div>
  );
}

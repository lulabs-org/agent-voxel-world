import { useI18n } from '../../../../i18n/context';
import type { AICharacterSummary } from '@voxel/shared';
import type { PublicPlanView } from '@voxel/shared/management';
import type { TaskPlansController } from '../useTaskPlans';
import { TaskPlanEditor } from '../editor/TaskPlanEditor';
import { TaskPlanToolbar } from './TaskPlanToolbar';
import { ActiveRuns } from '../runs/ActiveRuns';
import { RunHistory } from '../runs/RunHistory';
import {
  usePlanPresentation,
  usePlanStatusText,
} from '../presentation/usePlanPresentation';
import {
  timingIcon,
  timingLabel,
  planStatus,
  runEnded,
} from '../presentation/plan-presentation';
export function TaskPlanDetail({
  plan,
  characters,
  controller,
}: {
  plan: PublicPlanView;
  characters: AICharacterSummary[];
  controller: Pick<
    TaskPlansController,
    | 'runs'
    | 'locked'
    | 'blocked'
    | 'detailTab'
    | 'setDetailTab'
    | 'control'
    | 'runControl'
    | 'savePlan'
    | 'nextRunPage'
    | 'loadOlderRecords'
  >;
}) {
  const { t } = useI18n();
  const { bindingName } = usePlanPresentation(characters);
  const planStatusText = usePlanStatusText(plan);
  const {
    runs,
    locked,
    blocked,
    detailTab,
    setDetailTab,
    control,
    runControl,
    savePlan,
    nextRunPage,
    loadOlderRecords,
  } = controller;
  return (
    <article
      className="plans-detail"
      aria-label={t('console.plans.detailAria', { name: plan.name })}
    >
      <div className="plans-detail-heading">
        <div className="plans-identity">
          <span className="plans-avatar" aria-hidden="true">
            {timingIcon(plan.timing.kind)}
          </span>
          <div className="plans-identity-content">
            <div className="plans-identity-title-row">
              <h3>{plan.name}</h3>
              {plan.imported && (
                <span className="plans-tag">
                  {t('console.plans.importedTag')}
                </span>
              )}
            </div>
            <p>
              {t('console.plans.boundCharacter', {
                name: bindingName(plan),
              })}
              {timingLabel(plan)} · {plan.timeZone}
            </p>
          </div>
        </div>
        <span className="plans-presence" data-state={plan.state}>
          <span className="plans-presence-dot" data-state={plan.state} />
          {planStatus[plan.state] || plan.state}
        </span>
      </div>
      <nav
        className="plans-detail-tabs"
        aria-label={t('console.plans.detailTabsAria')}
      >
        {(
          [
            ['details', t('console.plans.detailTab')],
            [
              'active',
              `${t('console.plans.activeRuns')} (${runs.filter((r) => !runEnded(r)).length})`,
            ],
            ['history', t('console.plans.historyHeading')],
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            aria-current={detailTab === tab ? 'page' : undefined}
            onClick={() => setDetailTab(tab)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div hidden={detailTab !== 'details'}>
        <TaskPlanEditor
          key={`${plan.id}:${plan.characterId ?? ''}`}
          plan={plan}
          characterLocked={runs.some(
            (r) => r.status !== 'queued' && !runEnded(r),
          )}
          characters={characters}
          busy={locked}
          onSave={savePlan}
          footerActions={
            plan.state !== 'archived' && (
              <TaskPlanToolbar
                plan={plan}
                runs={runs}
                locked={locked}
                blocked={blocked}
                control={control}
              />
            )
          }
        />
        {blocked && plan.state !== 'archived' && (
          <p className="agent-hint plans-toolbar-hint">
            {t('console.plans.blockedCannotRun', { reason: blocked })}
          </p>
        )}
      </div>
      {detailTab === 'active' && (
        <ActiveRuns
          plan={plan}
          runs={runs}
          planStatusText={planStatusText}
          locked={locked}
          blocked={blocked}
          runControl={runControl}
        />
      )}
      {detailTab === 'history' && (
        <RunHistory
          plan={plan}
          runs={runs}
          characters={characters}
          locked={locked}
          runControl={runControl}
          nextRunPage={nextRunPage}
          loadOlderRecords={loadOlderRecords}
        />
      )}
    </article>
  );
}

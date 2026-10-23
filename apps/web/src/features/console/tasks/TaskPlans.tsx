import { ConsoleFeedbackRelay } from '../../../components/ui/ConsoleFeedbackRelay';
import type { AICharacterSummary } from '@voxel/shared';
import { useI18n } from '../../../i18n/context';
import { useTaskPlans } from './useTaskPlans';
import { TaskPlanSidebar } from './list/TaskPlanSidebar';
import { TaskPlanDetail } from './detail/TaskPlanDetail';
import { TaskPlanEditor } from './editor/TaskPlanEditor';
import './tasks.css';
import './presentation/presentation.css';
import './list/list.css';
import './detail/detail.css';
import './runs/runs.css';
import './editor/editor.css';
export function TaskPlans(props: {
  characters: AICharacterSummary[];
  active: boolean;
  disabled: boolean;
}) {
  const { characters, active } = props;
  const { t } = useI18n();
  const controller = useTaskPlans(props);
  const { creating, plan, locked, loading } = controller;
  return (
    <section
      aria-label={t('console.plans.managementAria')}
      className="plans-workspace"
    >
      <ConsoleFeedbackRelay error={controller.error} active={active} />
      <div className="console-columns">
        <TaskPlanSidebar controller={controller} characters={characters} />
        <div className="console-panel">
          {creating ? (
            <TaskPlanEditor
              key="new"
              characters={characters}
              busy={locked}
              onCancel={controller.cancelCreating}
              onSave={controller.createPlan}
            />
          ) : plan ? (
            <TaskPlanDetail
              plan={plan}
              characters={characters}
              controller={controller}
            />
          ) : (
            <div className="characters-welcome">
              <span className="characters-welcome-symbol" aria-hidden="true">
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </span>
              <h4>
                {loading
                  ? t('console.plans.welcomeSyncing')
                  : t('console.plans.welcomeNextTask')}
              </h4>
              <p>
                {t('console.plans.welcomeDescLine1')}
                <br />
                {t('console.plans.welcomeDescLine2')}
              </p>
              {!characters.length && (
                <p className="agent-notice">
                  {t('console.plans.noCharactersWarning')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

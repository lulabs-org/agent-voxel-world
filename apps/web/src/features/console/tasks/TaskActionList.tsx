import type { TaskRun } from '@voxel/shared';
import { useI18n } from '../../../i18n/context';
import { presentAction } from './presentation/task-action-presentation';

export function TaskActionList({
  actions = [],
  report,
}: {
  actions: TaskRun['actions'];
  report?: string;
}) {
  const { t } = useI18n();
  return (
    <details className="task-action-records">
      <summary>
        {t('console.plans.actualActions')}{' '}
        <span className="task-action-count">
          {t('console.plans.actionCount', { count: actions.length })}
        </span>
      </summary>
      {actions.length ? (
        <ol className="task-action-list">
          {actions.map((action, i) => {
            const view = presentAction(action);
            const feedback = view.feedback?.trim();
            return (
              <li
                key={`${action.batchId ?? action.call}:${action.index}`}
                className="task-action-item"
              >
                <span className="task-action-number" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="task-action-content">
                  <div className="task-action-heading">
                    <strong>{view.title}</strong>
                    <span className={`task-action-status is-${view.tone}`}>
                      {view.status}
                    </span>
                  </div>
                  {view.summary && (
                    <p className="task-action-summary">{view.summary}</p>
                  )}
                  {feedback &&
                    feedback !== report?.trim() &&
                    feedback !== view.summary?.trim() && (
                      <p className="task-action-feedback">{feedback}</p>
                    )}
                  <details className="task-action-raw">
                    <summary>{t('console.plans.rawActionData')}</summary>
                    <pre>{view.raw}</pre>
                  </details>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="task-action-empty">{t('console.plans.noActions')}</p>
      )}
    </details>
  );
}

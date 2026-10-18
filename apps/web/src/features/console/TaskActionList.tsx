import type { TaskRun } from '@voxel/shared';
import { presentAction } from './task-action-presentation';

export function TaskActionList({
  actions = [],
}: {
  actions: TaskRun['actions'];
}) {
  return (
    <details className="task-action-records">
      <summary>
        实际动作 <span className="task-action-count">{actions.length} 条</span>
      </summary>
      {actions.length ? (
        <ol className="task-action-list">
          {actions.map((action, i) => {
            const view = presentAction(action);
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
                    {view.summary && (
                      <span className="task-action-summary">
                        {view.summary}
                      </span>
                    )}
                  </div>
                  {view.feedback && (
                    <p className="task-action-feedback">{view.feedback}</p>
                  )}
                  <details className="task-action-raw">
                    <summary>原始数据</summary>
                    <pre>{view.raw}</pre>
                  </details>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="task-action-empty">暂无动作记录</p>
      )}
    </details>
  );
}

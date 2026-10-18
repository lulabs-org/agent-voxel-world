import type { ManagedAgentView } from '@voxel/shared';
import {
  taskDuration,
  taskPresentation,
} from './presentation/task-presentation';

export function AgentTaskResources({ job }: { job: ManagedAgentView }) {
  const presentation = taskPresentation(job);
  if (!presentation) return null;
  return (
    <section className="agents-resources" aria-label="资源用量">
      <div className="agents-task-heading">
        <h4>资源用量</h4>
        <span className="agents-section-label">当前额度周期</span>
      </div>
      <dl className="agents-resource-grid">
        {presentation.resources.map((resource) => (
          <div key={resource.id} data-exhausted={resource.exhausted}>
            <dt>
              {resource.label}
              {resource.exhausted && <span>已达上限</span>}
            </dt>
            <dd>
              <strong>
                {resource.estimated ? '约 ' : ''}
                {resource.id === 'time'
                  ? taskDuration(resource.used)
                  : resource.used.toLocaleString()}
              </strong>
              <small>
                上限{' '}
                {resource.id === 'time'
                  ? taskDuration(resource.limit)
                  : `${resource.limit.toLocaleString()} ${resource.unit}`}
              </small>
            </dd>
          </div>
        ))}
      </dl>
      <p>
        任一上限达到后暂停。预算在调用前后检查，单次调用可能超过剩余额度；token
        用量不等同于费用。执行时间不含等待。
      </p>
    </section>
  );
}

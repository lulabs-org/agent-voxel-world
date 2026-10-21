import type { TaskLimits } from '@voxel/shared';
import type { ReactNode } from 'react';
import { TaskBudgetFields } from '../execution/TaskBudgetFields';

export function TaskLimitSettings({
  value,
  onChange,
  children,
}: {
  value: TaskLimits;
  onChange: (limits: TaskLimits) => void;
  children?: ReactNode;
}) {
  const enabled = value.enabled !== false;
  return (
    <section className="plans-limit-box task-limits" aria-label="执行限制">
      <label className="task-limits-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        <span>启用执行限制</span>
      </label>
      {enabled ? (
        <>
          <TaskBudgetFields
            value={value}
            onChange={(next) => onChange({ ...value, ...next })}
          />
          {children}
        </>
      ) : (
        <p className="agent-hint">
          不限制调用次数、tokens 和执行时长。重复任务也不设累计额度。
        </p>
      )}
    </section>
  );
}

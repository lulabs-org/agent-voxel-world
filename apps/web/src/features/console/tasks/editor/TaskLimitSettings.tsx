import type { TaskLimits } from '@voxel/shared';
import type { ReactNode } from 'react';
import { useI18n } from '../../../../i18n/context';
import { TaskBudgetFields } from '../../execution/TaskBudgetFields';

export function TaskLimitSettings({
  value,
  onChange,
  children,
}: {
  value: TaskLimits;
  onChange: (limits: TaskLimits) => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const enabled = value.enabled !== false;
  return (
    <section
      className="task-limits"
      aria-label={t('console.plans.enableLimits')}
    >
      <label className="task-limits-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        <span>{t('console.plans.enableLimits')}</span>
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
        <p className="agent-hint">{t('console.plans.unlimitedLimitsHint')}</p>
      )}
    </section>
  );
}

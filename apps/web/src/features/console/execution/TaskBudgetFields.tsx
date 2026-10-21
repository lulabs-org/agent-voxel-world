import type { AICharacterSettings } from '@voxel/shared';
import { Clock, Coins, Repeat } from 'lucide-react';
import { useI18n } from '../../../i18n';

type TaskBudget = Pick<
  AICharacterSettings,
  'maxTurns' | 'tokenBudget' | 'taskTimeoutMs'
>;

export function TaskBudgetFields({
  value: agent,
  onChange: setAgent,
  hideHeading = false,
}: {
  value: TaskBudget;
  onChange: (value: TaskBudget) => void;
  hideHeading?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="agents-task-limits">
      {!hideHeading && (
        <>
          <h4>{t('console.budgetFields.heading')}</h4>
          <p className="agent-hint">
            {t('console.budgetFields.hint')}
          </p>
        </>
      )}
      <div className="agents-task-limits-grid">
        <label className="agents-task-limit-field">
          <span className="agents-field-label">
            <Repeat size={13} className="agents-field-icon" />
            {t('console.budgetFields.maxTurns')}
          </span>
          <div className="agents-input-with-unit">
            <input
              type="number"
              min={1}
              max={1000}
              required
              value={agent.maxTurns}
              onChange={(e) =>
                setAgent({
                  ...agent,
                  maxTurns: e.target.valueAsNumber,
                })
              }
            />
            <span className="agents-input-unit">{t('console.budgetFields.turnUnit')}</span>
          </div>
        </label>
        <label className="agents-task-limit-field">
          <span className="agents-field-label">
            <Coins size={13} className="agents-field-icon" />
            {t('console.budgetFields.tokenBudget')}
          </span>
          <div className="agents-input-with-unit">
            <input
              type="number"
              min={1000}
              max={100000000}
              required
              value={agent.tokenBudget ?? 50000}
              onChange={(e) =>
                setAgent({
                  ...agent,
                  tokenBudget: e.target.valueAsNumber,
                })
              }
            />
            <span className="agents-input-unit">{t('console.budgetFields.tokenUnit')}</span>
          </div>
        </label>
        <label className="agents-task-limit-field">
          <span className="agents-field-label">
            <Clock size={13} className="agents-field-icon" />
            {t('console.budgetFields.timeout')}
          </span>
          <div className="agents-input-with-unit">
            <input
              type="number"
              min={1}
              max={360}
              required
              value={(agent.taskTimeoutMs ?? 900000) / 60000}
              onChange={(e) =>
                setAgent({
                  ...agent,
                  taskTimeoutMs: e.target.valueAsNumber * 60000,
                })
              }
            />
            <span className="agents-input-unit">{t('console.budgetFields.minuteUnit')}</span>
          </div>
        </label>
      </div>
    </div>
  );
}

import { useI18n } from '../../../../i18n/context';
import type { AICharacterFormProps } from './types';
import * as Switch from '@radix-ui/react-switch';
import { Gauge } from 'lucide-react';
import { TaskBudgetFields } from '../../execution/TaskBudgetFields';
export function CharacterBudgetSettings({
  agent,
  setAgent,
}: Pick<AICharacterFormProps, 'agent' | 'setAgent'>) {
  const { t } = useI18n();
  return (
    <div className="agents-form-section agents-budget-settings">
      <div className="agents-toggle-card">
        <div className="agents-toggle-info">
          <strong>
            <Gauge size={15} />
            {t('console.characters.budgetSectionTitle')}
          </strong>
          <small>{t('console.characters.budgetSectionDesc')}</small>
        </div>
        <Switch.Root
          id="task-limits-switch"
          className="agents-switch-root"
          aria-label={t('console.characters.budgetSwitchAria')}
          checked={!!agent.taskLimitsEnabled}
          onCheckedChange={(checked) =>
            setAgent({
              ...agent,
              taskLimitsEnabled: checked,
            })
          }
        >
          <Switch.Thumb className="agents-switch-thumb" />
        </Switch.Root>
      </div>

      {agent.taskLimitsEnabled ? (
        <div className="agents-budget-content">
          <TaskBudgetFields
            value={agent}
            onChange={(limits) => setAgent({ ...agent, ...limits })}
          />
        </div>
      ) : (
        <p className="agents-budget-status">
          {t('console.characters.budgetDisabledStatus')}
        </p>
      )}
    </div>
  );
}

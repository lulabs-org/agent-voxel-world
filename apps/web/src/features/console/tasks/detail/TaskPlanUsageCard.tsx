import { useI18n } from '../../../../i18n/context';
import { hasPlanTokenLimit, type TaskPlan } from '@voxel/shared';
export function TaskPlanUsageCard({ plan }: { plan: TaskPlan }) {
  const { t } = useI18n();
  const budgetExhausted =
    hasPlanTokenLimit(plan) && plan.spentTokens >= plan.totalTokenBudget;
  return (
    <div className="plans-usage-grid">
      <div className="plans-usage-card" data-exhausted={budgetExhausted}>
        <div className="plans-usage-card-top">
          <span className="plans-usage-label">
            {t('console.plans.totalTokensConsumed')}
          </span>
          {hasPlanTokenLimit(plan) && (
            <span className="plans-usage-label">
              {t('console.plans.consumedPercent', {
                percent: (
                  (plan.spentTokens / Math.max(1, plan.totalTokenBudget)) *
                  100
                ).toFixed(1),
              })}
            </span>
          )}
        </div>
        <strong>
          {plan.spentTokens.toLocaleString()}
          <small>tokens</small>
        </strong>
        <span className="plans-usage-meta">
          {hasPlanTokenLimit(plan)
            ? t('console.plans.totalBudgetLabel', {
                tokens: plan.totalTokenBudget.toLocaleString(),
              })
            : t('console.plans.noBudgetLimit')}
        </span>
        {budgetExhausted && (
          <span className="plans-usage-warning" role="status">
            {t('console.plans.budgetExhausted')}
          </span>
        )}
        {hasPlanTokenLimit(plan) && (
          <div className="plans-progress-bar">
            <div
              className="plans-progress-fill"
              data-warning={plan.spentTokens / plan.totalTokenBudget > 0.8}
              style={{
                width: `${Math.min(
                  100,
                  Math.round(
                    (plan.spentTokens / Math.max(1, plan.totalTokenBudget)) *
                      100,
                  ),
                )}%`,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

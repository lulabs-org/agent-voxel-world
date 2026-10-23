import { dateInput } from './zoned-time';
import { TimingFields } from './TimingFields';
import {
  ConsoleFeedbackContext,
  ConsoleFeedbackRelay,
} from '../../../../components/ui/ConsoleFeedbackRelay';
import {
  DEFAULT_TASK_LIMITS,
  wallClockInstant,
  type TaskPlan,
  type TaskPlanDraft,
  type AICharacterSummary,
} from '@voxel/shared';
import { useContext, useState, type ReactNode } from 'react';
import { useI18n } from '../../../../i18n/context';
import { TaskLimitSettings } from './TaskLimitSettings';

export function TaskPlanEditor({
  plan,
  busy,
  onSave,
  onCancel,
  footerActions,
  characterLocked = false,
  characters,
}: {
  plan?: TaskPlan;
  busy: boolean;
  characters: AICharacterSummary[];
  onSave: (
    draft: TaskPlanDraft,
    requestId: string,
    characterId: string,
  ) => Promise<void>;
  onCancel?: () => void;
  footerActions?: ReactNode;
  characterLocked?: boolean;
}) {
  const { t } = useI18n();
  const feedback = useContext(ConsoleFeedbackContext);
  const [characterId, setCharacterId] = useState(plan?.characterId ?? '');
  const [requestId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<TaskPlanDraft>(() =>
    plan
      ? {
          ...plan,
          totalTokenBudgetEnabled:
            plan.totalTokenBudgetEnabled ?? plan.limits.enabled !== false,
        }
      : {
          name: '',
          goal: '',
          timing: { kind: 'immediate' },
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          limits: { ...DEFAULT_TASK_LIMITS },
          limitsMode: 'inherit',
          totalTokenBudgetEnabled: true,
          totalTokenBudget: 500000,
        },
  );
  const [at, setAt] = useState(() =>
    dateInput(
      plan?.timing.kind === 'once' ? plan.timing.at : Date.now() + 3600000,
      draft.timeZone,
    ),
  );
  const [intervalUnit, setIntervalUnit] = useState(
    plan?.timing.kind === 'interval' && plan.timing.everyMs % 3600000 === 0
      ? 3600000
      : 60000,
  );
  const [error, setError] = useState('');
  const target = characters.find((a) => a.id === characterId);
  const blocked = !target
    ? t('console.plans.reassignTitle')
    : !target.sessionId
      ? t('console.characters.filterOffline')
      : ['joining', 'stopping'].includes(target.status)
        ? t('console.characters.bannerTransitioning')
        : '';

  return (
    <form
      className="agent-form task-plan-editor"
      onSubmit={(e) => {
        void (async () => {
          e.preventDefault();
          setError('');
          const values = new FormData(e.currentTarget);
          let timing = draft.timing;
          if (timing.kind === 'daily' || timing.kind === 'weekly')
            timing = {
              ...timing,
              time: String(values.get('calendarTime') ?? timing.time),
            };
          if (timing.kind === 'once') {
            const [date, time] = String(values.get('executeAt') ?? at).split(
              'T',
            );
            const instant =
              date && time
                ? wallClockInstant(date, time, draft.timeZone)
                : undefined;
            if (instant === undefined) {
              setError(t('console.plans.editorSubtitle'));
              return;
            }
            timing = { kind: 'once', at: instant };
          }
          await onSave({ ...draft, timing }, requestId, characterId);
        })();
      }}
    >
      {!plan && (
        <div className="console-panel-heading plans-editor-heading">
          <div className="plans-editor-heading-row">
            <div>
              <h3>{t('console.plans.editorTitleNew')}</h3>
              <p>{t('console.plans.editorSubtitle')}</p>
            </div>
            <button type="button" onClick={onCancel} disabled={busy}>
              {t('common.back')}
            </button>
          </div>
        </div>
      )}
      <fieldset disabled={busy || plan?.state === 'archived'}>
        <div
          className="agents-form-section"
          style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}
        >
          <div className="agent-grid">
            <label>
              {t('console.plans.fieldCharacter')}
              {characterLocked ? (
                <button
                  type="button"
                  className="plans-character-locked"
                  onClick={() => {
                    feedback?.setNotice('');
                    feedback?.setError(t('console.plans.characterLockedHint'));
                  }}
                >
                  <span>
                    {target?.name ??
                      plan?.characterName ??
                      t('console.plans.selectCharacterPlaceholder')}
                  </span>
                  <span aria-hidden="true">⌄</span>
                </button>
              ) : (
                <select
                  required={!plan}
                  value={characterId}
                  onChange={(e) => setCharacterId(e.target.value)}
                >
                  <option value="">
                    {t('console.plans.selectCharacterPlaceholder')}
                  </option>
                  {characters.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {!a.sessionId ? t('console.plans.charOffline') : ''}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label>
              {t('console.plans.fieldName')}
              <input
                required
                maxLength={80}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t('console.plans.namePlaceholder')}
              />
            </label>
          </div>
          {!plan && (
            <p className="agent-hint">
              {t('console.plans.offlineAllowedNote')}
            </p>
          )}
          <label>
            {t('console.plans.fieldGoal')}
            <textarea
              required
              maxLength={2000}
              rows={3}
              value={draft.goal}
              onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
              placeholder={t('console.plans.goalPlaceholder')}
            />
          </label>
        </div>
        <TimingFields
          draft={draft}
          setDraft={setDraft}
          at={at}
          setAt={setAt}
          intervalUnit={intervalUnit}
          setIntervalUnit={setIntervalUnit}
        />
        <div className="agents-form-section">
          <h4>{t('console.plans.sectionLimits')}</h4>
          <label className="plans-budget-inherit">
            <input
              type="checkbox"
              checked={draft.limitsMode === 'inherit'}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  limitsMode: e.target.checked ? 'inherit' : 'override',
                })
              }
            />
            <span>{t('console.plans.inheritDefaultLimits')}</span>
          </label>
          {draft.limitsMode === 'inherit' && (
            <p className="agent-hint plans-budget-inherit-hint">
              {t('console.plans.inheritSnapshotHint')}
            </p>
          )}
          {draft.limitsMode !== 'inherit' && (
            <TaskLimitSettings
              value={draft.limits}
              onChange={(limits) => setDraft({ ...draft, limits })}
            />
          )}
          <div className="plans-total-budget">
            <label className="plans-total-budget-toggle">
              <input
                type="checkbox"
                checked={
                  draft.totalTokenBudgetEnabled ??
                  draft.limits.enabled !== false
                }
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    totalTokenBudgetEnabled: e.target.checked,
                  })
                }
              />
              <span>{t('console.plans.enableTotalBudget')}</span>
            </label>
            {(draft.totalTokenBudgetEnabled ??
              draft.limits.enabled !== false) && (
              <label className="plans-total-budget-field">
                {t('console.plans.totalBudgetField')}
                <input
                  type="number"
                  required
                  min={Math.max(
                    1000,
                    plan
                      ? Math.min(plan.spentTokens, plan.totalTokenBudget)
                      : 0,
                  )}
                  max={1000000000}
                  value={draft.totalTokenBudget}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      totalTokenBudget: e.target.valueAsNumber,
                    })
                  }
                />
                <small>{t('console.plans.totalBudgetHint')}</small>
              </label>
            )}
          </div>
          {plan && (
            <p className="agent-hint">{t('console.plans.limitsFutureOnly')}</p>
          )}
          {!plan && draft.timing.kind === 'immediate' && blocked && (
            <p role="status" className="agent-hint">
              {t('console.plans.blockedCannotRun', { reason: blocked })}
            </p>
          )}
          <ConsoleFeedbackRelay error={error} />
        </div>
        {plan?.state !== 'archived' && (
          <div className="agents-form-footer plans-editor-footer">
            <button
              className="primary"
              disabled={!plan && draft.timing.kind === 'immediate' && !!blocked}
            >
              {busy
                ? t('console.characters.saving')
                : plan
                  ? t('console.plans.saveScheduleButton')
                  : draft.timing.kind === 'immediate'
                    ? t('console.plans.createAndRunButton')
                    : t('console.plans.createPlanButton')}
            </button>
            {footerActions}
          </div>
        )}
      </fieldset>
    </form>
  );
}

import {
  DEFAULT_TASK_LIMITS,
  isRepeating,
  wallClockInstant,
  type TaskPlan,
  type TaskPlanDraft,
  type AICharacterSummary,
} from '@voxel/shared';
import { useState, type ReactNode } from 'react';
import { useI18n } from '../../../i18n/context';
import { TaskLimitSettings } from './TaskLimitSettings';

const dateInput = (at: number, zone: string) => {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const p = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
};

export function TaskPlanEditor({
  plan,
  busy,
  onSave,
  onCancel,
  footerActions,
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
}) {
  const { t } = useI18n();
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
  const repeating = isRepeating(draft.timing);
  const target = characters.find((a) => a.id === characterId);
  const blocked = !target
    ? t('console.plans.reassignTitle')
    : !target.sessionId
      ? t('console.characters.filterOffline')
      : ['joining', 'stopping'].includes(target.status)
        ? t('console.characters.bannerTransitioning')
        : '';

  const weekdayNames = [
    t('console.plans.weekdaySun'),
    t('console.plans.weekdayMon'),
    t('console.plans.weekdayTue'),
    t('console.plans.weekdayWed'),
    t('console.plans.weekdayThu'),
    t('console.plans.weekdayFri'),
    t('console.plans.weekdaySat'),
  ];

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
          <h4>{t('console.plans.sectionBasic')}</h4>
          <div className="agent-grid">
            <label>
              {t('console.plans.fieldCharacter')}
              <select
                required={!plan}
                disabled={!!plan}
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
        <div className="agents-form-section">
          <h4>{t('console.plans.sectionSchedule')}</h4>
          <label>
            {t('console.plans.fieldScheduleKind')}
            <select
              value={draft.timing.kind}
              onChange={(e) => {
                const kind = e.target.value as TaskPlanDraft['timing']['kind'];
                setDraft({
                  ...draft,
                  timing:
                    kind === 'once'
                      ? { kind, at: Date.now() + 3600000 }
                      : kind === 'interval'
                        ? { kind, everyMs: 3600000 }
                        : kind === 'daily'
                          ? { kind, time: '09:00' }
                          : kind === 'weekly'
                            ? { kind, time: '09:00', weekdays: [1] }
                            : { kind: 'immediate' },
                });
                if (kind === 'interval') setIntervalUnit(3600000);
              }}
            >
              <option value="immediate">
                {t('console.plans.timingImmediate')}
              </option>
              <option value="once">{t('console.plans.timingOnce')}</option>
              <option value="interval">
                {t('console.plans.timingInterval')}
              </option>
              <option value="daily">{t('console.plans.timingDaily')}</option>
              <option value="weekly">{t('console.plans.timingWeekly')}</option>
            </select>
          </label>
          {draft.timing.kind === 'once' && (
            <label>
              {t('console.plans.fieldDateTime')}
              <input
                type="datetime-local"
                name="executeAt"
                required
                defaultValue={at}
                onChange={(e) => setAt(e.target.value)}
              />
            </label>
          )}
          {draft.timing.kind === 'interval' && (
            <div className="agent-grid">
              <label>
                {t('console.plans.fieldEvery')}
                <input
                  type="number"
                  min={1}
                  max={(31 * 86400000) / intervalUnit}
                  required
                  value={draft.timing.everyMs / intervalUnit}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      timing: {
                        kind: 'interval',
                        everyMs: e.target.valueAsNumber * intervalUnit,
                      },
                    })
                  }
                />
              </label>
              <label>
                {t('console.plans.fieldUnit')}
                <select
                  value={intervalUnit}
                  onChange={(e) => {
                    const unit = Number(e.target.value);
                    setIntervalUnit(unit);
                    setDraft({
                      ...draft,
                      timing: {
                        kind: 'interval',
                        everyMs:
                          (draft.timing.kind === 'interval'
                            ? draft.timing.everyMs / intervalUnit
                            : 1) * unit,
                      },
                    });
                  }}
                >
                  <option value={60000}>
                    {t('console.plans.unitMinutes')}
                  </option>
                  <option value={3600000}>
                    {t('console.plans.unitHours')}
                  </option>
                </select>
              </label>
            </div>
          )}
          {(draft.timing.kind === 'daily' ||
            draft.timing.kind === 'weekly') && (
            <label>
              {t('console.plans.fieldTime')}
              <input
                type="time"
                name="calendarTime"
                required
                defaultValue={draft.timing.time}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    timing: {
                      ...draft.timing,
                      ...{ time: e.target.value },
                    } as TaskPlanDraft['timing'],
                  })
                }
              />
            </label>
          )}
          {draft.timing.kind === 'weekly' && (
            <div
              className="plans-weekday-chips task-weekdays"
              role="group"
              aria-label={t('console.plans.fieldWeekdaysAria')}
            >
              {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                <label key={day}>
                  <input
                    type="checkbox"
                    checked={
                      draft.timing.kind === 'weekly' &&
                      draft.timing.weekdays.includes(day)
                    }
                    onChange={(e) => {
                      if (draft.timing.kind === 'weekly')
                        setDraft({
                          ...draft,
                          timing: {
                            ...draft.timing,
                            weekdays: e.target.checked
                              ? [...draft.timing.weekdays, day]
                              : draft.timing.weekdays.filter((d) => d !== day),
                          },
                        });
                    }}
                  />
                  {weekdayNames[day]}
                </label>
              ))}
            </div>
          )}
          <p className="agent-hint">
            {t('console.plans.timeZoneLabel', { tz: draft.timeZone })}
            {draft.timing.kind === 'interval'
              ? t('console.plans.intervalStartHint')
              : ''}
            {repeating ? t('console.plans.queuePolicyHint') : ''}
          </p>
        </div>
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
          {repeating && (
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
          )}
          {plan && (
            <p className="agent-hint">{t('console.plans.limitsFutureOnly')}</p>
          )}
          {!plan && draft.timing.kind === 'immediate' && blocked && (
            <p role="status" className="agent-hint">
              {t('console.plans.blockedCannotRun', { reason: blocked })}
            </p>
          )}
          {error && (
            <p role="alert" className="agent-error">
              {error}
            </p>
          )}
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

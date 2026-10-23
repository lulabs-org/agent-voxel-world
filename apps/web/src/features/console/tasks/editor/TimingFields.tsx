import { useI18n } from '../../../../i18n/context';
import { isRepeating, type TaskPlanDraft } from '@voxel/shared';
export function TimingFields({
  draft,
  setDraft,
  at,
  setAt,
  intervalUnit,
  setIntervalUnit,
}: {
  draft: TaskPlanDraft;
  setDraft: (draft: TaskPlanDraft) => void;
  at: string;
  setAt: (at: string) => void;
  intervalUnit: number;
  setIntervalUnit: (unit: number) => void;
}) {
  const { t } = useI18n();
  const repeating = isRepeating(draft.timing);
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
          <option value="interval">{t('console.plans.timingInterval')}</option>
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
              <option value={60000}>{t('console.plans.unitMinutes')}</option>
              <option value={3600000}>{t('console.plans.unitHours')}</option>
            </select>
          </label>
        </div>
      )}
      {(draft.timing.kind === 'daily' || draft.timing.kind === 'weekly') && (
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
  );
}

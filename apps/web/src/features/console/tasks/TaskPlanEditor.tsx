import {
  DEFAULT_TASK_LIMITS,
  isRepeating,
  wallClockInstant,
  type TaskPlan,
  type TaskPlanDraft,
} from '@voxel/shared';
import { useState } from 'react';
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
  blocked,
  onSave,
  onCancel,
}: {
  plan?: TaskPlan;
  busy: boolean;
  blocked: string;
  onSave: (draft: TaskPlanDraft, requestId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<TaskPlanDraft>(
    () =>
      plan ?? {
        name: '',
        goal: '',
        timing: { kind: 'immediate' },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        limits: { ...DEFAULT_TASK_LIMITS },
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
  return (
    <form
      className="agent-form task-plan-editor"
      onSubmit={async (e) => {
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
          const [date, time] = String(values.get('executeAt') ?? at).split('T');
          const instant =
            date && time
              ? wallClockInstant(date, time, draft.timeZone)
              : undefined;
          if (instant === undefined) {
            setError('该日期或时间在此时区不存在，请重新选择。');
            return;
          }
          timing = { kind: 'once', at: instant };
        }
        await onSave({ ...draft, timing }, requestId);
      }}
    >
      <div className="agents-task-heading">
        <h4>{plan ? '编辑任务安排' : '新建任务'}</h4>
        <button type="button" onClick={onCancel} disabled={busy}>
          取消
        </button>
      </div>
      <fieldset disabled={busy}>
        <label>
          任务名称
          <input
            required
            maxLength={80}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="例如：巡查营地"
          />
        </label>
        <label>
          目标与完成条件
          <textarea
            required
            maxLength={2000}
            rows={3}
            value={draft.goal}
            onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
            placeholder="例如：查看营地附近三处建筑，汇报位置和变化后结束本次执行。"
          />
        </label>
        <label>
          执行方式
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
            <option value="immediate">立即执行一次</option>
            <option value="once">指定时间执行一次</option>
            <option value="interval">重复 · 固定间隔</option>
            <option value="daily">重复 · 每天</option>
            <option value="weekly">重复 · 每周</option>
          </select>
        </label>
        {draft.timing.kind === 'once' && (
          <label>
            执行日期和时间
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
              每隔
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
              间隔单位
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
                <option value={60000}>分钟</option>
                <option value={3600000}>小时</option>
              </select>
            </label>
          </div>
        )}
        {(draft.timing.kind === 'daily' || draft.timing.kind === 'weekly') && (
          <label>
            执行时间
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
          <div className="task-weekdays" role="group" aria-label="执行星期">
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
                周{'日一二三四五六'[day]}
              </label>
            ))}
          </div>
        )}
        <p className="agent-hint">
          时区：{draft.timeZone}
          {draft.timing.kind === 'interval'
            ? ' · 以创建时刻为起点，首次在一个间隔后执行。'
            : ''}
          {repeating ? ' 每次独立执行，忙碌或离线时跳过，不补跑。' : ''}
        </p>
        <TaskLimitSettings
          value={draft.limits}
          onChange={(limits) => setDraft({ ...draft, limits })}
        >
          {repeating && (
            <label>
              计划累计 token 额度
              <input
                type="number"
                required
                min={Math.max(1000, plan?.spentTokens ?? 0)}
                max={1000000000}
                value={draft.totalTokenBudget}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    totalTokenBudget: e.target.valueAsNumber,
                  })
                }
              />
              <small>所有执行（含手动执行）共用此额度，用尽后暂停计划。</small>
            </label>
          )}
        </TaskLimitSettings>
        {plan && (
          <p className="agent-hint">
            仅影响未来执行。已有执行的目标、进度和额度保持原样。
          </p>
        )}
        {!plan && draft.timing.kind === 'immediate' && blocked && (
          <p role="status" className="agent-hint">
            {blocked}，可以先保存一个定时安排。
          </p>
        )}
        {error && (
          <p role="alert" className="agent-error">
            {error}
          </p>
        )}
        <div className="agents-form-footer">
          <button
            className="primary"
            disabled={!plan && draft.timing.kind === 'immediate' && !!blocked}
          >
            {busy
              ? '保存中…'
              : plan
                ? '保存安排'
                : draft.timing.kind === 'immediate'
                  ? '创建并执行'
                  : '创建任务'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

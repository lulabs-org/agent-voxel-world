import {
  DEFAULT_TASK_LIMITS,
  isRepeating,
  wallClockInstant,
  type TaskPlan,
  type TaskPlanDraft,
  type AICharacterView,
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
  characters,
}: {
  plan?: TaskPlan;
  busy: boolean;
  blocked: string;
  characters: AICharacterView[];
  onSave: (
    draft: TaskPlanDraft,
    requestId: string,
    characterId: string,
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const [characterId, setCharacterId] = useState(plan?.characterId ?? '');
  const [requestId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<TaskPlanDraft>(
    () =>
      plan ?? {
        name: '',
        goal: '',
        timing: { kind: 'immediate' },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        limits: { ...DEFAULT_TASK_LIMITS },
        limitsMode: 'inherit',
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
  blocked = !target
    ? '请选择执行角色'
    : !target.sessionId
      ? '角色尚未上线'
      : ['joining', 'stopping'].includes(target.status)
        ? '角色正在上线或下线'
        : '';
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
        await onSave({ ...draft, timing }, requestId, characterId);
      }}
    >
      <div className="console-panel-heading plans-editor-heading">
        <div className="plans-editor-heading-row">
          <div>
            <h3>{plan ? '编辑任务计划' : '新建任务计划'}</h3>
            <p>配置任务目标、执行角色、触发方式与资源限制。</p>
          </div>
          <button type="button" onClick={onCancel} disabled={busy}>
            返回
          </button>
        </div>
      </div>
      <fieldset disabled={busy}>
        <div
          className="characters-form-section"
          style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}
        >
          <h4>基本目标</h4>
          <div className="agent-grid">
            <label>
              执行角色
              <select
                required={!plan}
                disabled={!!plan}
                value={characterId}
                onChange={(e) => setCharacterId(e.target.value)}
              >
                <option value="">{plan ? '待指派' : '请选择执行角色'}</option>
                {characters.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {!a.sessionId ? ' · 离线' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              计划名称
              <input
                required
                maxLength={80}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="例如：巡查营地"
              />
            </label>
          </div>
          <p className="agent-hint">
            未来计划允许选择离线角色；到期仍离线会跳过。改派请在计划详情操作。
          </p>
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
        </div>
        <div className="characters-form-section">
          <h4>调度与触发</h4>
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
          {(draft.timing.kind === 'daily' ||
            draft.timing.kind === 'weekly') && (
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
            <div
              className="plans-weekday-chips task-weekdays"
              role="group"
              aria-label="执行星期"
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
            {repeating
              ? ' 忙碌时排队，同一计划最多一个待执行项；离线错过不补跑。'
              : ''}
          </p>
        </div>
        <div className="characters-form-section">
          <h4>执行限制与资源预算</h4>
          <label>
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
            使用角色默认执行额度
          </label>
          {draft.limitsMode === 'inherit' && (
            <p className="agent-hint">开始执行时读取角色默认额度并保存快照。</p>
          )}
          {draft.limitsMode !== 'inherit' && (
            <>
              <TaskLimitSettings
                value={draft.limits}
                onChange={(limits) => setDraft({ ...draft, limits })}
              />
            </>
          )}
          {repeating && (
            <label style={{ marginTop: 14 }}>
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
        </div>
        <div className="characters-form-footer">
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
                  : '创建计划'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

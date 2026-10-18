import {
  isRepeating,
  type ManagedAgentView,
  type TaskLimits,
  type TaskPlan,
  type TaskRun,
} from '@voxel/shared';
import { useEffect, useRef, useState } from 'react';
import type { ConsoleController } from '../useConsoleController';
import { tasksApi } from './api';
import {
  planStatus,
  planTime,
  runEnded,
  runStatus,
  timingLabel,
} from './presentation/task-plan-presentation';
import { TaskPlanEditor } from './TaskPlanEditor';
import { TaskRunDetails } from './TaskRunDetails';

export function AgentTaskPanel({
  job,
  active,
  disabled,
}: ConsoleController & {
  job: ManagedAgentView;
  active: boolean;
  disabled: boolean;
  capacityFull: boolean;
}) {
  const historyDepth = useRef(20);
  const runRequests = useRef<Record<string, string>>({});
  const [plans, setPlans] = useState<TaskPlan[]>([]),
    [runs, setRuns] = useState<TaskRun[]>([]);
  const [selected, setSelected] = useState<string>(),
    [editing, setEditing] = useState<string>();
  const [shownRun, setShownRun] = useState<string>(),
    [page, setPage] = useState<number>();
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [loading, setLoading] = useState(true),
    [archived, setArchived] = useState(false),
    [extend, setExtend] = useState(false),
    [extra, setExtra] = useState(500000);
  useEffect(() => {
    setSelected(undefined);
    setEditing(undefined);
    setPlans([]);
    setRuns([]);
    setLoading(true);
  }, [job.id]);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const values = await tasksApi.listTaskPlans(job.id, abort.signal);
        const history = selected
          ? await tasksApi.listTaskRuns(job.id, selected, 0, abort.signal)
          : undefined;
        if (abort.signal.aborted) return;
        setPlans(values);
        setLoading(false);
        if (history) {
          const current = [
            ...history.active,
            ...history.items.filter(
              (r) => !history.active.some((a) => a.id === r.id),
            ),
          ];
          setRuns((old) => [
            ...current,
            ...old.filter(
              (r) => runEnded(r) && !current.some((n) => n.id === r.id),
            ),
          ]);
          setPage(
            historyDepth.current < history.total
              ? historyDepth.current
              : undefined,
          );
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          setError(e instanceof Error ? e.message : '无法读取任务');
          setLoading(false);
        }
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 2000);
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [job.id, active, selected, revision]);
  const plan = plans.find((p) => p.id === selected),
    editPlan = plans.find((p) => p.id === editing);
  const occupied =
    job.status === 'joining' ||
    job.status === 'stopping' ||
    job.status === 'running' ||
    (job.status !== 'failed' &&
      ['running', 'waiting'].includes(job.task?.status ?? ''));
  const blocked = !job.sessionId
    ? '角色尚未上线'
    : occupied
      ? '角色正在执行其他工作'
      : '';
  const locked = busy || disabled;
  const mutate = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成');
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const planAction = async (
    p: TaskPlan,
    op: 'run' | 'pause' | 'resume' | 'archive' | 'extend',
    body: unknown = {},
  ) => {
    try {
      await mutate(() =>
        tasksApi.taskPlanAction(
          job.id,
          p.id,
          op,
          op === 'run'
            ? { requestId: (runRequests.current[p.id] ??= crypto.randomUUID()) }
            : body,
        ),
      );
      if (op === 'run') delete runRequests.current[p.id];
      if (op === 'archive') setSelected(undefined);
    } catch {
      /* error is shown locally */
    }
  };
  const runAction = async (
    r: TaskRun,
    op: 'pause' | 'resume' | 'cancel',
    limits?: TaskLimits,
  ) => {
    try {
      await mutate(() => tasksApi.taskRunAction(job.id, r.id, op, limits));
    } catch {
      /* error is shown locally */
    }
  };
  const open = (p: TaskPlan) => {
    historyDepth.current = 20;
    setSelected(p.id);
    setRuns([]);
    setPage(undefined);
    setShownRun(undefined);
    setExtend(false);
    setError('');
  };
  const shown = plans.filter((p) =>
    archived ? p.state === 'archived' : p.state !== 'archived',
  );
  return (
    <section className="agents-task-panel task-workspace" aria-label="任务管理">
      {error && (
        <p role="alert" className="agent-error">
          {error}
        </p>
      )}
      {editing ? (
        <TaskPlanEditor
          key={editing}
          plan={editPlan}
          busy={locked}
          blocked={blocked}
          onCancel={() => setEditing(undefined)}
          onSave={async (draft, requestId) => {
            try {
              await mutate(() =>
                tasksApi.saveTaskPlan(job.id, draft, editPlan?.id, requestId),
              );
              setEditing(undefined);
            } catch {
              /* retain draft */
            }
          }}
        />
      ) : plan ? (
        <>
          <div className="task-detail-overview">
            <button
              className="agents-text-button task-detail-back"
              onClick={() => {
                setSelected(undefined);
                setRuns([]);
              }}
            >
              ← 任务列表
            </button>
            <div className="task-detail-heading">
              <h4 className="task-plan-title">{plan.name}</h4>
              <span className="task-plan-badge">{planStatus[plan.state]}</span>
            </div>
            {plan.goal.trim() !== plan.name.trim() && (
              <p className="task-run-goal">{plan.goal}</p>
            )}
            <div className="task-plan-schedule">
              <span>{timingLabel(plan)}</span>
              {plan.nextRunAt && plan.timing.kind !== 'once' && (
                <span>下次 {planTime(plan.nextRunAt, plan.timeZone)}</span>
              )}
              {plan.timing.kind !== 'immediate' && <span>{plan.timeZone}</span>}
            </div>
            {plan.reason &&
              !runs.some((r) => !runEnded(r) && r.reason === plan.reason) && (
                <p className="task-run-reason" role="status">
                  {plan.reason}
                </p>
              )}
            {plan.state !== 'archived' && (
              <div className="agents-actions task-detail-actions">
                <button
                  className="primary"
                  disabled={locked || !!blocked}
                  onClick={() => void planAction(plan, 'run')}
                >
                  立即执行
                </button>
                {(isRepeating(plan.timing) || plan.timing.kind === 'once') && (
                  <button
                    disabled={locked}
                    title="只控制后续触发，不影响本次执行"
                    onClick={() =>
                      void planAction(
                        plan,
                        plan.state === 'enabled' ? 'pause' : 'resume',
                      )
                    }
                  >
                    {plan.state === 'enabled' ? '暂停计划' : '恢复计划'}
                  </button>
                )}
                <button disabled={locked} onClick={() => setEditing(plan.id)}>
                  编辑安排
                </button>
                <button
                  disabled={locked || runs.some((r) => !runEnded(r))}
                  onClick={() => void planAction(plan, 'archive')}
                >
                  归档
                </button>
              </div>
            )}
            {blocked && plan.state !== 'archived' && (
              <p className="agent-hint">{blocked}，暂时不能手动执行。</p>
            )}
            {isRepeating(plan.timing) && (
              <div className="task-plan-budget">
                <span>
                  累计用量 <strong>{plan.spentTokens.toLocaleString()}</strong>
                  {plan.limits.enabled === false
                    ? ' tokens · 不设上限'
                    : ` / ${plan.totalTokenBudget.toLocaleString()} tokens`}
                </span>
                {plan.state !== 'archived' && plan.limits.enabled !== false && (
                  <button
                    className="agents-text-button"
                    onClick={() => setExtend(!extend)}
                  >
                    追加额度
                  </button>
                )}
                {extend && plan.limits.enabled !== false && (
                  <form
                    className="agent-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await planAction(plan, 'extend', { tokens: extra });
                      setExtend(false);
                    }}
                  >
                    <label>
                      追加 tokens
                      <input
                        type="number"
                        min={1000}
                        max={1000000000}
                        required
                        value={extra}
                        onChange={(e) => setExtra(e.target.valueAsNumber)}
                      />
                    </label>
                    <button disabled={locked}>确认追加</button>
                    <small>保留历史用量；追加后仍需手动恢复计划。</small>
                  </form>
                )}
              </div>
            )}
          </div>
          <div className="task-run-section">
            <div className="task-section-heading">
              <h4>当前执行</h4>
              {!runs.some((r) => !runEnded(r)) && (
                <small>暂无进行中的执行</small>
              )}
            </div>
            {runs
              .filter((r) => !runEnded(r))
              .map((r) => (
                <TaskRunDetails
                  key={r.id}
                  run={r}
                  planGoal={plan.goal}
                  busy={locked}
                  blocked={blocked}
                  onAction={runAction}
                />
              ))}
          </div>
          <div className="task-run-section">
            <div className="task-section-heading">
              <h4>历史执行</h4>
              {!runs.some(runEnded) && <small>暂无记录</small>}
            </div>
            {runs.filter(runEnded).map((r) => (
              <div key={r.id} className="task-history-item">
                <button
                  className="task-history-toggle"
                  aria-expanded={shownRun === r.id}
                  onClick={() =>
                    setShownRun(shownRun === r.id ? undefined : r.id)
                  }
                >
                  <span>
                    {planTime(
                      r.startedAt ?? r.scheduledAt,
                      r.snapshot.timeZone,
                    )}{' '}
                    · {r.snapshot.timeZone}
                    <small>
                      {r.source === 'scheduled'
                        ? '计划触发'
                        : r.source === 'chat'
                          ? '聊天安排'
                          : r.source === 'legacy'
                            ? '旧任务迁移'
                            : '手动执行'}
                    </small>
                  </span>
                  <span>{runStatus[r.status]}</span>
                </button>
                {shownRun === r.id && (
                  <TaskRunDetails
                    run={r}
                    planGoal={plan.goal}
                    hideHeading
                    busy={locked}
                    blocked={blocked}
                    onAction={runAction}
                  />
                )}
              </div>
            ))}
            {page !== undefined && (
              <button
                disabled={locked}
                onClick={async () => {
                  try {
                    await mutate(async () => {
                      const result = await tasksApi.listTaskRuns(
                        job.id,
                        plan.id,
                        page,
                      );
                      setRuns((old) => [
                        ...old,
                        ...result.items.filter(
                          (r) => !old.some((o) => o.id === r.id),
                        ),
                      ]);
                      historyDepth.current = page + result.items.length;
                      setPage(result.nextOffset);
                    });
                  } catch {
                    /* displayed */
                  }
                }}
              >
                加载更早记录
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="agents-task-heading">
            <div>
              <h4>任务安排</h4>
              <p className="agent-hint">一次性目标，或按时重复执行。</p>
            </div>
            <button
              className="primary"
              disabled={locked}
              onClick={() => setEditing('new')}
            >
              ＋ 新建任务
            </button>
          </div>
          <div className="task-list-filter">
            <button aria-pressed={!archived} onClick={() => setArchived(false)}>
              任务
            </button>
            <button aria-pressed={archived} onClick={() => setArchived(true)}>
              已归档
            </button>
          </div>
          {loading ? (
            <p role="status">正在读取任务…</p>
          ) : shown.length === 0 ? (
            <div className="agents-task-empty">
              <h4>{archived ? '没有已归档任务' : '安排下一件事'}</h4>
              <p>
                {archived
                  ? '结束执行后，可归档任务并保留历史。'
                  : '现在做一次，或设定时间让角色定期执行。'}
              </p>
            </div>
          ) : (
            <div className="task-plan-list">
              {shown.map((p) => (
                <article className="task-plan-card" key={p.id}>
                  <button className="task-plan-open" onClick={() => open(p)}>
                    <div className="task-card-heading">
                      <strong title={p.name}>{p.name}</strong>
                      <span className="task-plan-badge">
                        {planStatus[p.state]}
                      </span>
                    </div>
                    <div className="task-card-meta">
                      <span>{timingLabel(p)}</span>
                      {p.nextRunAt && p.timing.kind !== 'once' && (
                        <span>下次 {planTime(p.nextRunAt, p.timeZone)}</span>
                      )}
                      {p.timing.kind !== 'immediate' && (
                        <span>{p.timeZone}</span>
                      )}
                    </div>
                    <div className="task-plan-latest">
                      <span>
                        {p.latestRun
                          ? runStatus[p.latestRun.status]
                          : '尚未执行'}
                      </span>
                      <span>
                        {p.latestRun?.reason ||
                          p.latestRun?.task?.summary ||
                          '执行结果将在这里显示'}
                      </span>
                    </div>
                  </button>
                  <div className="task-card-actions">
                    <button onClick={() => open(p)}>查看详情</button>
                    {p.state !== 'archived' && (
                      <button
                        disabled={locked || !!blocked}
                        title={blocked || undefined}
                        onClick={() => void planAction(p, 'run')}
                      >
                        立即执行
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          {blocked && (
            <p className="agent-hint">{blocked}。可以创建未来的任务安排。</p>
          )}
        </>
      )}
    </section>
  );
}

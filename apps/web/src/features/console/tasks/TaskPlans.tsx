import { useEffect, useRef, useState } from 'react';
import type {
  ManagedAgentView,
  TaskPlan,
  TaskLimits,
  TaskRun,
} from '@voxel/shared';
import type { PublicPlanView, RpcParams } from '@voxel/gateway-protocol';
import { refreshOnGatewayChange } from '../../../network/gateway';
import { tasksApi, displayedTaskIdentity, type PlanPage } from './api';
import { TaskPlanEditor } from './TaskPlanEditor';
import { TaskRunDetails } from './TaskRunDetails';
import {
  planStatus,
  planTime,
  timingLabel,
  runEnded,
} from './presentation/task-plan-presentation';
import './tasks.css';

const timingIcon = (kind: TaskPlan['timing']['kind']) => {
  switch (kind) {
    case 'immediate':
      return '⚡';
    case 'once':
      return '⏱';
    case 'interval':
    case 'daily':
    case 'weekly':
      return '↻';
    default:
      return '📋';
  }
};

export function TaskPlans({
  agents,
  active,
  disabled,
}: {
  agents: ManagedAgentView[];
  active: boolean;
  disabled: boolean;
}) {
  const [filters, setFilters] = useState<RpcParams>({});
  const [page, setPage] = useState<PlanPage>({ items: [], total: 0 });
  const [selected, setSelected] = useState<string>();
  const [plan, setPlan] = useState<PublicPlanView>();
  const [editor, setEditor] = useState<{ plan?: TaskPlan } | null>(null);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [nextRunPage, setNextRunPage] = useState<number>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [readError, setReadError] = useState(''),
    [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0),
    [target, setTarget] = useState('');
  const [extra, setExtra] = useState(500000),
    [extend, setExtend] = useState(false);
  const [reassign, setReassign] = useState(false);
  const historyDepth = useRef(20);
  const mutation = useRef(false);

  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    const read = async () => {
      try {
        const list = await tasksApi.list(filters, abort.signal);
        const current = selected
          ? await tasksApi.get(selected, abort.signal)
          : undefined;
        let history: TaskRun[] = [],
          next: number | undefined;
        if (selected) {
          let offset = 0;
          do {
            const result = await tasksApi.runs(selected, offset, abort.signal);
            history.push(...result.active, ...result.items);
            next = result.nextOffset;
            if (next === undefined || next >= historyDepth.current) break;
            offset = next;
          } while (!abort.signal.aborted);
        }
        if (abort.signal.aborted) return;
        setReadError('');
        setPage(list);
        setPlan(current);
        setRuns([...new Map(history.map((r) => [r.id, r])).values()]);
        setNextRunPage(next);
        setLoading(false);
      } catch (e) {
        if (!abort.signal.aborted) {
          setReadError(e instanceof Error ? e.message : '无法读取计划');
          setLoading(false);
        }
      }
    };
    const stop = refreshOnGatewayChange(read, { resource: 'plans' });
    return () => {
      abort.abort();
      stop();
    };
  }, [active, selected, filters, revision]);

  const mutate = async (action: () => Promise<unknown>) => {
    if (mutation.current || disabled) return;
    mutation.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成');
      throw e;
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  const changeFilter = (value: RpcParams) => {
    setFilters((old) => ({ ...old, ...value, offset: 0 }));
  };

  const bindingName = (p: TaskPlan) =>
    p.agentId
      ? (agents.find((a) => a.id === p.agentId)?.name ??
        p.agentName ??
        '未知角色')
      : p.agentName
        ? `${['completed', 'archived'].includes(p.state) ? '' : '待指派 · '}${p.agentName}（已删除）`
        : '待指派';

  const job = agents.find((a) => a.id === plan?.agentId);
  const blocked = !job
    ? '请先指派执行角色'
    : !job.sessionId
      ? '角色尚未上线'
      : ['joining', 'stopping', 'running'].includes(job.status) ||
          ['running', 'waiting'].includes(job.task?.status ?? '')
        ? '角色正在执行其他工作'
        : '';
  const locked = busy || disabled;

  const control = async (
    operation: string,
    value: Record<string, unknown> = {},
  ) => {
    if (!plan) return;
    try {
      await mutate(() =>
        tasksApi.control(
          plan,
          operation,
          value,
          operation === 'run' ? displayedTaskIdentity(job) : undefined,
        ),
      );
    } catch {
      /* displayed */
    }
  };

  const runControl = async (
    run: TaskRun,
    operation: 'pause' | 'resume' | 'cancel',
    limits?: TaskLimits,
  ) => {
    const owner = agents.find((a) => a.id === run.agentId);
    try {
      await mutate(() =>
        tasksApi.controlRun(
          run.id,
          operation,
          { ...limits },
          displayedTaskIdentity(owner),
        ),
      );
    } catch {
      /* displayed */
    }
  };

  const openPlan = (id: string) => {
    setSelected(id);
    setRevision((v) => v + 1);
    setPlan(undefined);
    setRuns([]);
    historyDepth.current = 20;
    setError('');
    setReassign(false);
    setExtend(false);
  };

  return (
    <section aria-label="任务计划管理" className="plans-workspace">
      {(error || readError) && (
        <p className="agent-error" role="alert">
          {error || readError}
        </p>
      )}
      {!agents.length && (
        <p className="agent-notice">
          暂无可用角色。请先在“AI 角色”创建 AI 角色；已有计划和历史仍可查看。
        </p>
      )}
      <div className="console-columns">
        <aside className="console-sidebar" aria-label="任务计划列表">
          <div className="console-sidebar-heading">
            <h3>任务计划</h3>
            <span>{page.total} 项</span>
          </div>
          <button
            className="primary console-sidebar-add"
            disabled={locked || !agents.length || !!editor}
            onClick={() => setEditor({})}
          >
            ＋ 新建计划
          </button>
          <div className="plans-sidebar-filter">
            <div
              className="plans-state-pills"
              role="group"
              aria-label="筛选计划状态"
            >
              {(
                [
                  ['', '全部'],
                  ['enabled', '已启用'],
                  ['paused', '已暂停'],
                  ['completed', '已完成'],
                  ['archived', '已归档'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={(filters.state ?? '') === value}
                  onClick={() =>
                    changeFilter({
                      state: (value as RpcParams['state']) || undefined,
                    })
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="console-sidebar-items">
            {page.items.map((p) => (
              <button
                key={p.id}
                className="console-sidebar-item"
                aria-pressed={selected === p.id && !editor}
                disabled={!!editor}
                onClick={() => openPlan(p.id)}
              >
                <span className="plans-mini-badge" aria-hidden="true">
                  {timingIcon(p.timing.kind)}
                </span>
                <span className="console-sidebar-copy">
                  <strong title={p.name}>{p.name}</strong>
                  <small>
                    {bindingName(p)} · {timingLabel(p)}
                  </small>
                </span>
                <span
                  className="plans-presence-dot"
                  data-state={p.state}
                  title={planStatus[p.state] || p.state}
                  aria-label={planStatus[p.state] || p.state}
                />
              </button>
            ))}
            {!page.items.length && (
              <p className="agents-list-empty">
                {loading ? '正在读取计划…' : '没有符合条件的计划'}
              </p>
            )}
          </div>
          {(page.total > 20 || !!filters.offset) && (
            <div className="plans-sidebar-pagination">
              <button
                disabled={!filters.offset}
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    offset: Math.max(0, (f.offset ?? 0) - 20),
                  }))
                }
              >
                ‹ 上一页
              </button>
              <span className="plans-sidebar-pagination-info">
                {(filters.offset ?? 0) + 1} -{' '}
                {Math.min((filters.offset ?? 0) + 20, page.total)} / {page.total}
              </span>
              <button
                disabled={page.nextOffset === undefined}
                onClick={() =>
                  setFilters((f) => ({ ...f, offset: page.nextOffset }))
                }
              >
                下一页 ›
              </button>
            </div>
          )}
          <p className="console-sidebar-note">
            定时与周期任务由网关调度，离线角色到达执行时间时将跳过。
          </p>
        </aside>
        <div className="console-panel">
          {editor ? (
            <TaskPlanEditor
              key={editor.plan?.id ?? 'new'}
              plan={editor.plan}
              agents={agents}
              busy={locked}
              blocked=""
              onCancel={() => setEditor(null)}
              onSave={async (draft, requestId, agentId) => {
                try {
                  let saved: TaskPlan | undefined;
                  await mutate(async () => {
                    saved = await tasksApi.save(
                      agentId,
                      draft,
                      editor.plan,
                      requestId,
                    );
                  });
                  if (saved) {
                    setEditor(null);
                    openPlan(saved.id);
                  }
                } catch {
                  /* retain draft */
                }
              }}
            />
          ) : plan ? (
            <article
              className="plans-detail"
              aria-label={`${plan.name}的计划详情`}
            >
              <div className="plans-detail-heading">
                <div className="plans-identity">
                  <span className="plans-avatar" aria-hidden="true">
                    {timingIcon(plan.timing.kind)}
                  </span>
                  <div className="plans-identity-content">
                    <div className="plans-identity-title-row">
                      <h3>{plan.name}</h3>
                      {plan.imported && (
                        <span className="plans-tag">历史导入</span>
                      )}
                    </div>
                    <p>
                      执行角色：<strong>{bindingName(plan)}</strong> ·{' '}
                      {timingLabel(plan)} · {plan.timeZone}
                    </p>
                  </div>
                </div>
                <span className="plans-presence" data-state={plan.state}>
                  <span
                    className="plans-presence-dot"
                    data-state={plan.state}
                  />
                  {planStatus[plan.state] || plan.state}
                </span>
              </div>
              <div className="plans-presence-bar">
                <p>
                  {plan.nextRunAt
                    ? `下次计划执行：${planTime(plan.nextRunAt, plan.timeZone)}`
                    : plan.state === 'completed'
                      ? '该一次性计划已全部执行完毕。'
                      : plan.state === 'paused'
                        ? '计划当前处于暂停状态，不会自动触发。'
                        : plan.state === 'archived'
                          ? '该计划已归档，历史记录与用量保留。'
                          : '计划就绪，等待触发条件或手动启动。'}
                </p>
                {plan.timing.kind !== 'immediate' &&
                  plan.state !== 'archived' && (
                    <button
                      disabled={
                        locked || (!plan.agentId && plan.state !== 'enabled')
                      }
                      onClick={() =>
                        void control(
                          plan.state === 'enabled' ? 'pause' : 'resume',
                        )
                      }
                    >
                      {plan.state === 'enabled' ? '暂停计划' : '启用计划'}
                    </button>
                  )}
              </div>
              {plan.reason && (
                <p className="agent-notice" style={{ margin: '0 0 16px' }}>
                  {plan.reason}
                </p>
              )}
              <div className="plans-goal-card">
                <span className="plans-card-label">计划目标与完成条件</span>
                <p className="plans-goal-text">{plan.goal}</p>
              </div>
              <div className="plans-usage-grid">
                <div className="plans-usage-card">
                  <div className="plans-usage-card-top">
                    <span className="plans-usage-label">累计消耗 Tokens</span>
                    {plan.state !== 'archived' && (
                      <button
                        className="plans-usage-action"
                        disabled={locked}
                        onClick={() => setExtend(!extend)}
                      >
                        追加额度
                      </button>
                    )}
                  </div>
                  <strong>
                    {plan.spentTokens.toLocaleString()}
                    <small>tokens</small>
                  </strong>
                  <span className="plans-usage-meta">
                    {plan.limits.enabled !== false &&
                    plan.timing.kind !== 'immediate'
                      ? `计划总预算 ${plan.totalTokenBudget.toLocaleString()} tokens`
                      : '未设预算上限'}
                  </span>
                  {plan.limits.enabled !== false &&
                    plan.timing.kind !== 'immediate' && (
                      <div className="plans-progress-bar">
                        <div
                          className="plans-progress-fill"
                          data-warning={
                            plan.spentTokens / plan.totalTokenBudget > 0.8
                          }
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round(
                                (plan.spentTokens /
                                  Math.max(1, plan.totalTokenBudget)) *
                                  100,
                              ),
                            )}%`,
                          }}
                        />
                      </div>
                    )}
                </div>
                <div className="plans-usage-card">
                  <span className="plans-usage-label">执行记录与单次限额</span>
                  <strong>
                    {runs.length}
                    <small>次记录</small>
                  </strong>
                  <span className="plans-usage-meta">
                    {plan.limits.enabled !== false
                      ? `单次上限：${plan.limits.maxTurns} 轮调用 / ${(plan.limits.tokenBudget ?? 50000).toLocaleString()} tokens`
                      : '单次执行不限调用与额度'}
                  </span>
                </div>
              </div>
              {extend && (
                <form
                  className="agent-form plans-drawer-card"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void control('extend', { tokens: extra });
                  }}
                >
                  <h4>追加计划 token 额度</h4>
                  <label>
                    追加 tokens
                    <input
                      type="number"
                      min="1000"
                      max="1000000000"
                      required
                      value={extra}
                      onChange={(e) => setExtra(e.target.valueAsNumber)}
                    />
                  </label>
                  <p className="agent-hint">
                    保留历史用量；追加后计划保持当前状态，如已暂停需手动恢复。
                  </p>
                  <div className="plans-drawer-actions">
                    <button className="primary" disabled={locked}>
                      确认追加
                    </button>
                    <button type="button" onClick={() => setExtend(false)}>
                      取消
                    </button>
                  </div>
                </form>
              )}
              {plan.state !== 'archived' && (
                <div className="plans-toolbar">
                  <button
                    className="primary"
                    disabled={
                      locked || !!blocked || runs.some((r) => !runEnded(r))
                    }
                    onClick={() =>
                      void control('run', { requestId: crypto.randomUUID() })
                    }
                  >
                    立即执行
                  </button>
                  <button
                    disabled={locked}
                    onClick={() => setEditor({ plan: structuredClone(plan) })}
                  >
                    编辑计划
                  </button>
                  <button
                    disabled={locked || runs.some((r) => !runEnded(r))}
                    onClick={() => {
                      setReassign(!reassign);
                      setTarget('');
                    }}
                  >
                    改派角色
                  </button>
                  <button
                    disabled={locked || runs.some((r) => !runEnded(r))}
                    onClick={() => void control('archive')}
                  >
                    归档计划
                  </button>
                </div>
              )}
              {blocked && plan.state !== 'archived' && (
                <p
                  className="agent-hint"
                  style={{ marginTop: -10, marginBottom: 16 }}
                >
                  {blocked}，暂时不能立即执行。
                </p>
              )}
              {reassign && (
                <form
                  className="agent-form plans-drawer-card"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await mutate(() => tasksApi.reassign(plan, target));
                      setReassign(false);
                    } catch {}
                  }}
                >
                  <h4>改派执行角色</h4>
                  <label>
                    选择新的执行角色
                    <select
                      required
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">请选择角色</option>
                      {agents
                        .filter((a) => a.id !== plan.agentId)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className="agent-hint">
                    改派后计划保持暂停状态，历史和累计用量保留。
                  </p>
                  <div className="plans-drawer-actions">
                    <button className="primary" disabled={locked || !target}>
                      确认改派
                    </button>
                    <button type="button" onClick={() => setReassign(false)}>
                      取消
                    </button>
                  </div>
                </form>
              )}
              <div className="plans-section-heading">
                <h4>当前执行</h4>
                <span className="plans-section-badge">
                  {runs.filter((r) => !runEnded(r)).length} 项活跃
                </span>
              </div>
              {!runs.some((r) => !runEnded(r)) && (
                <p className="agent-hint" style={{ margin: '4px 0 16px' }}>
                  暂无未结束的执行
                </p>
              )}
              {runs
                .filter((r) => !runEnded(r))
                .map((r) => (
                  <TaskRunDetails
                    key={r.id}
                    run={r}
                    planGoal={plan.goal}
                    busy={locked}
                    blocked={blocked}
                    onAction={runControl}
                  />
                ))}
              <div className="plans-section-heading">
                <h4>执行历史</h4>
                <span className="plans-section-badge">
                  {runs.filter(runEnded).length} 条记录
                </span>
              </div>
              {!runs.some(runEnded) && (
                <p className="agent-hint" style={{ margin: '4px 0 16px' }}>
                  暂无历史执行
                </p>
              )}
              {runs.filter(runEnded).map((r) => (
                <details
                  key={r.id}
                  className="plans-history-card task-history-item"
                >
                  <summary className="plans-history-summary">
                    <span>
                      {planTime(
                        r.startedAt ?? r.scheduledAt,
                        r.snapshot.timeZone,
                      )}{' '}
                      · {r.agentName}
                      {!agents.some((a) => a.id === r.agentId)
                        ? '（已删除）'
                        : ''}
                    </span>
                    <span
                      className="plans-presence-dot"
                      data-state={
                        r.status === 'completed' ? 'completed' : 'paused'
                      }
                    />
                  </summary>
                  <div className="plans-history-body">
                    <TaskRunDetails
                      run={r}
                      planGoal={plan.goal}
                      hideHeading
                      busy={locked}
                      blocked=""
                      onAction={runControl}
                    />
                  </div>
                </details>
              ))}
              {nextRunPage !== undefined && (
                <div style={{ marginTop: 12 }}>
                  <button
                    disabled={locked}
                    onClick={() => {
                      historyDepth.current += 20;
                      setRevision((v) => v + 1);
                    }}
                  >
                    加载更早记录
                  </button>
                </div>
              )}
            </article>
          ) : (
            <div className="agents-welcome">
              <span className="agents-welcome-symbol" aria-hidden="true">
                ⏱
              </span>
              <h4>{loading ? '正在同步计划…' : '安排下一项任务'}</h4>
              <p>
                为 AI 伙伴集中安排即时任务、定时日程或周期循环巡查。
                <br />
                选择左侧计划查看执行进展，或直接新建计划。
              </p>
              {!loading && agents.length > 0 && !editor && (
                <button
                  className="primary"
                  disabled={locked}
                  onClick={() => setEditor({})}
                >
                  ＋ 新建任务计划
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

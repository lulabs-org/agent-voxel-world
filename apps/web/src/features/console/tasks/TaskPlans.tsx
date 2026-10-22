import { useEffect, useRef, useState } from 'react';
import type {
  AICharacterView,
  TaskPlan,
  TaskLimits,
  TaskRun,
} from '@voxel/shared';
import type { PublicPlanView, PlanQueryFilter } from '@voxel/shared/management';
import { useI18n } from '../../../i18n/context';
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
  characters,
  active,
  disabled,
}: {
  characters: AICharacterView[];
  active: boolean;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [filters, setFilters] = useState<PlanQueryFilter>({});
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
        const history: TaskRun[] = [];
        let next: number | undefined;
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
          setReadError(e instanceof Error ? e.message : t('console.plans.noMatchPlans'));
          setLoading(false);
        }
      }
    };
    const stop = refreshOnGatewayChange(read, { resource: 'plans' });
    return () => {
      abort.abort();
      stop();
    };
  }, [active, selected, filters, revision, t]);

  const mutate = async (action: () => Promise<unknown>) => {
    if (mutation.current || disabled) return;
    mutation.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('console.characters.operationFailed'));
      throw e;
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  const changeFilter = (value: PlanQueryFilter) => {
    setFilters((old) => ({ ...old, ...value, offset: 0 }));
  };

  const bindingName = (p: TaskPlan) =>
    p.characterId
      ? (characters.find((a) => a.id === p.characterId)?.name ??
        p.characterName ??
        t('console.plans.deletedTag'))
      : p.characterName
        ? `${['completed', 'archived'].includes(p.state) ? '' : `${t('console.plans.reassignTitle')} · `}${p.characterName}${t('console.plans.deletedTag')}`
        : t('console.plans.reassignTitle');

  const job = characters.find((a) => a.id === plan?.characterId);
  const blocked = !job
    ? t('console.plans.reassignTitle')
    : !job.sessionId
      ? t('console.characters.filterOffline')
      : ['joining', 'stopping'].includes(job.status)
        ? t('console.characters.bannerTransitioning')
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
    const owner = characters.find((a) => a.id === run.characterId);
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
    <section aria-label={t('console.plans.managementAria')} className="plans-workspace">
      {(error || readError) && (
        <p className="agent-error" role="alert">
          {error || readError}
        </p>
      )}
      {!characters.length && (
        <p className="agent-notice">
          {t('console.plans.noCharactersWarning')}
        </p>
      )}
      <div className="console-columns">
        <aside className="console-sidebar" aria-label={t('console.plans.listAria')}>
          <div className="console-sidebar-heading">
            <h3>{t('console.plans.title')}</h3>
            <span>{t('console.plans.totalCount', { total: page.total })}</span>
          </div>
          <button
            className="primary console-sidebar-add"
            disabled={locked || !characters.length || !!editor}
            onClick={() => setEditor({})}
          >
            {t('console.plans.createButton')}
          </button>
          <div className="plans-sidebar-filter">
            <div
              className="plans-state-pills"
              role="group"
              aria-label={t('console.plans.filterStatusAria')}
            >
              {(
                [
                  ['', t('console.plans.filterAll')],
                  ['enabled', t('console.plans.statusEnabled')],
                  ['paused', t('console.plans.statusPaused')],
                  ['completed', t('console.plans.statusCompleted')],
                  ['archived', t('console.plans.statusArchived')],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={(filters.state ?? '') === value}
                  onClick={() =>
                    changeFilter({
                      state: (value as PlanQueryFilter['state']) || undefined,
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
              <p className="characters-list-empty">
                {loading ? t('console.plans.loadingPlans') : t('console.plans.noMatchPlans')}
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
                {t('console.plans.prevPage')}
              </button>
              <span className="plans-sidebar-pagination-info">
                {(filters.offset ?? 0) + 1} -{' '}
                {Math.min((filters.offset ?? 0) + 20, page.total)} /{' '}
                {page.total}
              </span>
              <button
                disabled={page.nextOffset === undefined}
                onClick={() =>
                  setFilters((f) => ({ ...f, offset: page.nextOffset }))
                }
              >
                {t('console.plans.nextPage')}
              </button>
            </div>
          )}
          <p className="console-sidebar-note">
            {t('console.plans.cronNote')}
          </p>
        </aside>
        <div className="console-panel">
          {editor ? (
            <TaskPlanEditor
              key={editor.plan?.id ?? 'new'}
              plan={editor.plan}
              characters={characters}
              busy={locked}
              blocked=""
              onCancel={() => setEditor(null)}
              onSave={async (draft, requestId, characterId) => {
                try {
                  let saved: TaskPlan | undefined;
                  await mutate(async () => {
                    saved = await tasksApi.save(
                      characterId,
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
              aria-label={t('console.plans.detailAria', { name: plan.name })}
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
                        <span className="plans-tag">{t('console.plans.importedTag')}</span>
                      )}
                    </div>
                    <p>
                      {t('console.plans.boundCharacter', { name: bindingName(plan) })}
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
                    ? t('console.plans.nextRunAt', { time: planTime(plan.nextRunAt, plan.timeZone) })
                    : plan.state === 'completed'
                      ? t('console.plans.stateCompletedDesc')
                      : plan.state === 'paused'
                        ? t('console.plans.statePausedDesc')
                        : plan.state === 'archived'
                          ? t('console.plans.stateArchivedDesc')
                          : t('console.plans.stateReadyDesc')}
                </p>
                {plan.timing.kind !== 'immediate' &&
                  plan.state !== 'archived' && (
                    <button
                      disabled={
                        locked ||
                        (!plan.characterId && plan.state !== 'enabled')
                      }
                      onClick={() =>
                        void control(
                          plan.state === 'enabled' ? 'pause' : 'resume',
                        )
                      }
                    >
                      {plan.state === 'enabled'
                        ? t('console.plans.pausePlan')
                        : t('console.plans.enablePlan')}
                    </button>
                  )}
              </div>
              {plan.reason && (
                <p className="agent-notice" style={{ margin: '0 0 16px' }}>
                  {plan.reason}
                </p>
              )}
              <div className="plans-goal-card">
                <span className="plans-card-label">{t('console.plans.targetAndCondition')}</span>
                <p className="plans-goal-text">{plan.goal}</p>
              </div>
              <div className="plans-usage-grid">
                <div className="plans-usage-card">
                  <div className="plans-usage-card-top">
                    <span className="plans-usage-label">{t('console.plans.totalTokensConsumed')}</span>
                    {plan.state !== 'archived' && (
                      <button
                        className="plans-usage-action"
                        disabled={locked}
                        onClick={() => setExtend(!extend)}
                      >
                        {t('console.plans.addBudget')}
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
                      ? t('console.plans.totalBudgetLabel', { tokens: plan.totalTokenBudget.toLocaleString() })
                      : t('console.plans.noBudgetLimit')}
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
                  <span className="plans-usage-label">{t('console.plans.recordsAndLimit')}</span>
                  <strong>
                    {runs.length}
                    <small>{t('console.plans.recordCount')}</small>
                  </strong>
                  <span className="plans-usage-meta">
                    {plan.limitsMode === 'inherit'
                      ? t('console.plans.inheritsCharacterBudget')
                      : plan.limits.enabled !== false
                        ? t('console.plans.singleRunLimit', {
                          turns: plan.limits.maxTurns,
                          tokens: (plan.limits.tokenBudget ?? 50000).toLocaleString(),
                        })
                        : t('console.plans.singleRunNoLimit')}
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
                  <h4>{t('console.plans.addTokensTitle')}</h4>
                  <label>
                    {t('console.plans.addTokensLabel')}
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
                    {t('console.plans.addTokensHint')}
                  </p>
                  <div className="plans-drawer-actions">
                    <button className="primary" disabled={locked}>
                      {t('console.plans.confirmAdd')}
                    </button>
                    <button type="button" onClick={() => setExtend(false)}>
                      {t('common.cancel')}
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
                    {t('console.plans.runNow')}
                  </button>
                  <button
                    disabled={locked}
                    onClick={() => setEditor({ plan: structuredClone(plan) })}
                  >
                    {t('console.plans.editPlan')}
                  </button>
                  <button
                    disabled={
                      locked ||
                      runs.some((r) => r.status !== 'queued' && !runEnded(r))
                    }
                    onClick={() => {
                      setReassign(!reassign);
                      setTarget('');
                    }}
                  >
                    {t('console.plans.reassignCharacter')}
                  </button>
                  <button
                    disabled={
                      locked ||
                      runs.some((r) => r.status !== 'queued' && !runEnded(r))
                    }
                    onClick={() => void control('archive')}
                  >
                    {t('console.plans.archivePlan')}
                  </button>
                </div>
              )}
              {blocked && plan.state !== 'archived' && (
                <p
                  className="agent-hint"
                  style={{ marginTop: -10, marginBottom: 16 }}
                >
                  {t('console.plans.blockedCannotRun', { reason: blocked })}
                </p>
              )}
              {reassign && (
                <form
                  className="agent-form plans-drawer-card"
                  onSubmit={(e) => {
                    void (async () => {
                      e.preventDefault();
                      try {
                        await mutate(() => tasksApi.reassign(plan, target));
                        setReassign(false);
                      } catch {
                        // mutate has already displayed the failure; keep the editor open.
                      }
                    })();
                  }}
                >
                  <h4>{t('console.plans.reassignTitle')}</h4>
                  <label>
                    {t('console.plans.selectNewCharacter')}
                    <select
                      required
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">{t('console.plans.selectCharacterPlaceholder')}</option>
                      {characters
                        .filter((a) => a.id !== plan.characterId)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className="agent-hint">
                    {t('console.plans.reassignHint')}
                  </p>
                  <div className="plans-drawer-actions">
                    <button className="primary" disabled={locked || !target}>
                      {t('console.plans.confirmReassign')}
                    </button>
                    <button type="button" onClick={() => setReassign(false)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </form>
              )}
              <div className="plans-section-heading">
                <h4>{t('console.plans.activeRuns')}</h4>
                <span className="plans-section-badge">
                  {t('console.plans.activeItems', { count: runs.filter((r) => !runEnded(r)).length })}
                </span>
              </div>
              {!runs.some((r) => !runEnded(r)) && (
                <p className="agent-hint" style={{ margin: '4px 0 16px' }}>
                  {t('console.plans.noActiveRuns')}
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
                <h4>{t('console.plans.historyHeading')}</h4>
                <span className="plans-section-badge">
                  {t('console.plans.historyCount', { count: runs.filter(runEnded).length })}
                </span>
              </div>
              {!runs.some(runEnded) && (
                <p className="agent-hint" style={{ margin: '4px 0 16px' }}>
                  {t('console.plans.noHistoryRuns')}
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
                      · {r.characterName}
                      {!characters.some((a) => a.id === r.characterId)
                        ? t('console.plans.deletedTag')
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
                    {t('console.plans.loadOlderRecords')}
                  </button>
                </div>
              )}
            </article>
          ) : (
            <div className="characters-welcome">
              <span className="characters-welcome-symbol" aria-hidden="true">
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </span>
              <h4>{loading ? t('console.plans.welcomeSyncing') : t('console.plans.welcomeNextTask')}</h4>
              <p>
                {t('console.plans.welcomeDescLine1')}
                <br />
                {t('console.plans.welcomeDescLine2')}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

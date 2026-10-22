import { useState } from 'react';
import './ai-characters.css';
import { useI18n } from '../../../i18n/context';
import type { ConsoleController } from '../useConsoleController';
import { AICharacterDetail } from './AICharacterDetail';
import { AICharacterForm } from './AICharacterForm';
import { aiCharacterPresentation } from './presentation/agent-presentation';

type Filter = 'all' | 'online' | 'attention' | 'offline';
export function AICharacterList(
  props: ConsoleController & { active: boolean },
) {
  const { t } = useI18n();
  const {
    jobs,
    busy,
    pollError,
    loadingJobs,
    selectedAgentId,
    showAgentForm,
    editingAgent,
    openAgentEditor,
  } = props;
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const creating = showAgentForm && !editingAgent;
  const current = jobs.find((job) => job.id === selectedAgentId) ?? jobs[0];
  const onlineCount = jobs.filter(
    (job) => aiCharacterPresentation(job).occupiesSlot,
  ).length;
  const disabled = busy || loadingJobs || !!pollError;
  const filtered = jobs.filter((job) => {
    const state = aiCharacterPresentation(job);
    return (
      job.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (filter === 'all' ||
        (filter === 'online' && state.occupiesSlot) ||
        (filter === 'offline' && !state.occupiesSlot) ||
        (filter === 'attention' && state.attention))
    );
  });
  return (
    <section className="agents-workspace" aria-label={t('console.characters.managementAria')}>
      {pollError && (
        <p role="alert" className="agent-error">
          {t('console.characters.pollErrorHint', { error: pollError })}
        </p>
      )}
      <div className="agents-layout console-columns">
        <aside className="console-sidebar" aria-label={t('console.characters.listAria')}>
          <div className="console-sidebar-heading">
            <h3>{t('console.characters.title')}</h3>
            <span>
              {loadingJobs
                ? t('console.characters.syncing')
                : t('console.characters.onlineCount', { online: onlineCount })}
            </span>
          </div>
          <button
            className="primary console-sidebar-add"
            disabled={disabled}
            onClick={() => openAgentEditor()}
          >
            ＋ {t('console.characters.create')}
          </button>
          <div
            className="agents-filters"
            role="group"
            aria-label={t('console.characters.filterAria')}
          >
            {(
              [
                ['all', t('console.characters.filterAll')],
                ['online', t('console.characters.filterOnline')],
                ['attention', t('console.characters.filterAttention')],
                ['offline', t('console.characters.filterOffline')],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {jobs.length > 4 && (
            <input
              className="agents-search"
              aria-label={t('console.characters.searchAria')}
              placeholder={t('console.characters.searchPlaceholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
          <div className="console-sidebar-items">
            {filtered.map((job) => {
              const state = aiCharacterPresentation(job);
              return (
                <button
                  className="console-sidebar-item"
                  key={job.id}
                  aria-pressed={!creating && current?.id === job.id}
                  disabled={busy}
                  onClick={() => {
                    // 侧栏点击应打开该角色的「设置」；若已在编辑它则保持不动
                    // （避免丢弃未保存的修改），绝不回退到「运行记录」视图。
                    if (showAgentForm && editingAgent === job.id) return;
                    openAgentEditor(job);
                  }}
                >
                  <span className="agents-mini-avatar" aria-hidden="true">
                    {Array.from(job.name)[0]}
                  </span>
                  <span className="console-sidebar-copy">
                    <strong title={job.name}>{job.name}</strong>
                    <small>
                      {state.transitioning
                        ? state.presence
                        : state.online
                          ? state.taskLabel
                          : t('console.characters.presenceNotInWorld')}
                    </small>
                  </span>
                  <span
                    className="agents-presence-dot"
                    data-online={state.online}
                    data-attention={state.attention}
                    aria-label={state.presence}
                  />
                </button>
              );
            })}
            {!filtered.length && (
              <p className="agents-list-empty">
                {loadingJobs
                  ? t('console.characters.listLoading')
                  : jobs.length
                    ? t('console.characters.listNoMatch')
                    : t('console.characters.listEmptyCreated')}
              </p>
            )}
          </div>
          <p className="console-sidebar-note">
            {onlineCount >= 4
              ? t('console.characters.capacityFullNote')
              : t('console.characters.offlineRetentionNote')}
          </p>
        </aside>
        <div
          className="agents-main console-panel console-agent-panel"
          aria-busy={busy || loadingJobs}
        >
          {creating ? (
            <AICharacterForm {...props} disabled={disabled} />
          ) : current ? (
            <AICharacterDetail
              key={current.id}
              {...props}
              job={current}
              disabled={disabled}
              capacityFull={onlineCount >= 4}
            />
          ) : (
            <div className="agents-welcome">
              <span className="agents-welcome-symbol" aria-hidden="true">
                ◇
              </span>
              <h4>
                {loadingJobs
                  ? t('console.characters.welcomeConnecting')
                  : t('console.characters.welcomeTitle')}
              </h4>
              <p>
                {t('console.characters.welcomeDescLine1')}
                <br />
                {t('console.characters.welcomeDescLine2')}
              </p>
              <button
                className="primary"
                disabled={disabled}
                onClick={() => openAgentEditor()}
              >
                {t('console.characters.welcomeCreate')}
              </button>
              <div className="agents-welcome-capabilities">
                <span>{t('console.characters.capExplore')}</span>
                <span>{t('console.characters.capBuild')}</span>
                <span>{t('console.characters.capVoice')}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

import { useState } from 'react';
import './ai-characters.css';
import type { ConsoleController } from '../useConsoleController';
import { AICharacterDetail } from './AICharacterDetail';
import { AICharacterForm } from './AICharacterForm';
import { aiCharacterPresentation } from './presentation/agent-presentation';

type Filter = 'all' | 'online' | 'attention' | 'offline';
export function AICharacterList(
  props: ConsoleController & { active: boolean },
) {
  const {
    jobs,
    busy,
    pollError,
    loadingJobs,
    selectedAgentId,
    selectAgent,
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
    <section className="agents-workspace" aria-label="AI 角色管理">
      {pollError && (
        <p role="alert" className="agent-error">
          {pollError} 当前显示上次同步的记录，恢复连接后可继续操作。
        </p>
      )}
      <div className="agents-layout console-columns">
        <aside className="console-sidebar" aria-label="AI 角色列表">
          <div className="console-sidebar-heading">
            <h3>AI 角色</h3>
            <span>{loadingJobs ? '同步中…' : `${onlineCount} / 4 在线`}</span>
          </div>
          <button
            className="primary console-sidebar-add"
            disabled={disabled}
            onClick={() => openAgentEditor()}
          >
            ＋ 创建 AI 角色
          </button>
          <div
            className="agents-filters"
            role="group"
            aria-label="筛选 AI 角色"
          >
            {(
              [
                ['all', '全部'],
                ['online', '在线'],
                ['attention', '待处理'],
                ['offline', '离线'],
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
              aria-label="搜索 AI 角色"
              placeholder="搜索 AI 角色名称"
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
                  onClick={() => selectAgent(job.id)}
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
                          : '未在世界中'}
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
                  ? '正在读取 AI 角色…'
                  : jobs.length
                    ? '没有符合条件的 AI 角色'
                    : '创建后，AI 角色会显示在这里。'}
              </p>
            )}
          </div>
          <p className="console-sidebar-note">
            {onlineCount >= 4
              ? '在线名额已满，仍可创建离线 AI 角色；上线前请先释放名额。'
              : 'AI 角色离开世界后仍保留设置，下次可以再次加入。'}
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
              <h4>{loadingJobs ? '正在连接你的世界' : '一起开始探索'}</h4>
              <p>
                为 AI 角色选择一个模型，给它起个名字。
                <br />
                它可以先加入世界待命，也可以带着任务出发。
              </p>
              <button
                className="primary"
                disabled={disabled}
                onClick={() => openAgentEditor()}
              >
                创建第一位 AI 角色
              </button>
              <div className="agents-welcome-capabilities">
                <span>探索与交流</span>
                <span>协作搭建</span>
                <span>语音回复</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

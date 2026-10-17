import { agentPermissions } from '@voxel/shared';
import { useState } from 'react';
import type { ManagedAgentView } from '@voxel/shared';
import type { ConsoleController } from './useConsoleController';
import { agentPresentation } from './agent-presentation';
import { AgentForm } from './AgentForm';
import { AgentLogViewer } from './AgentLogViewer';
import { AgentTaskPanel } from './AgentTaskPanel';

export function AgentDetail(
  props: ConsoleController & {
    job: ManagedAgentView;
    active: boolean;
    disabled: boolean;
    capacityFull: boolean;
  },
) {
  const {
    job,
    disabled,
    capacityFull,
    joinAgent,
    stopAgent,
    openAgentEditor,
    showAgentForm,
    editingAgent,
    setShowAgentForm,
    setNotice,
    setError,
  } = props;
  const [view, setView] = useState<'task' | 'activity'>('task');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const state = agentPresentation(job);
  const editing = showAgentForm && editingAgent === job.id;
  return (
    <article className="agents-detail" aria-label={`${job.name}的工作区`}>
      <div className="agents-detail-heading">
        <div className="agents-identity">
          <span className="agents-avatar" aria-hidden="true">
            {Array.from(job.name)[0]}
          </span>
          <div>
            <h3>{job.name}</h3>
            <p>
              {job.providerName} · {job.model}
            </p>
          </div>
        </div>
        <span className="agents-presence" data-online={state.online}>
          <span className="agents-presence-dot" data-online={state.online} />
          {state.presence}
        </span>
      </div>
      <div className="agents-presence-bar">
        <p>
          {!agentPermissions(job).chat
            ? '发送聊天已关闭，角色不会发送文字或语音回复。可在控制台安排任务和查看进展。'
            : state.online
              ? '可在世界中私聊或 @ 交流。关闭控制台后仍保持在线。'
              : '上线后可交流；原任务会保留，由你决定是否继续。'}
        </p>
        {state.occupiesSlot ? (
          <button
            className="agents-text-button"
            disabled={disabled || job.status === 'stopping'}
            onClick={() => setConfirmLeave(true)}
          >
            离开世界
          </button>
        ) : (
          <button
            disabled={disabled || capacityFull}
            onClick={() => void joinAgent(job)}
          >
            加入世界待命
          </button>
        )}
      </div>
      {job.status === 'failed' && (
        <p role="alert" className="agent-error">
          上次连接或执行未成功。
          {job.logs.at(-1) || '请检查世界连接与模型配置。'}{' '}
          可在“运行记录”中查看详情。
        </p>
      )}
      {confirmLeave && (
        <div className="agents-confirm" role="group" aria-label="确认离开世界">
          <p>离开后将停止交流与任务执行，角色设置和任务进度保留。</p>
          <div className="agents-actions">
            <button
              disabled={disabled}
              onClick={() => {
                setConfirmLeave(false);
                void stopAgent(job);
              }}
            >
              确认离开
            </button>
            <button onClick={() => setConfirmLeave(false)}>留下</button>
          </div>
        </div>
      )}
      <nav className="agents-detail-nav" aria-label="角色工作区分类">
        <button
          aria-pressed={!editing && view === 'task'}
          onClick={() => {
            setShowAgentForm(false);
            setView('task');
            setError('');
            setNotice('');
          }}
        >
          任务
        </button>
        <button
          aria-pressed={editing}
          disabled={disabled}
          onClick={() => openAgentEditor(job)}
        >
          角色设置
        </button>
        <button
          aria-pressed={!editing && view === 'activity'}
          onClick={() => {
            setShowAgentForm(false);
            setView('activity');
            setError('');
            setNotice('');
          }}
        >
          运行记录
        </button>
      </nav>
      {editing ? (
        <AgentForm {...props} disabled={disabled || !state.canEdit} />
      ) : view === 'activity' ? (
        <AgentLogViewer job={job} />
      ) : (
        <AgentTaskPanel {...props} />
      )}
    </article>
  );
}

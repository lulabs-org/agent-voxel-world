import type { AICharacterView } from '@voxel/shared';
import { aiCharacterPermissions } from '@voxel/shared';
import { useEffect, useRef, useState } from 'react';
import type { ConsoleController } from '../useConsoleController';
import { AICharacterForm } from './AICharacterForm';
import { AICharacterLogViewer } from './AICharacterLogViewer';
import { aiCharacterPresentation } from './presentation/agent-presentation';
import { aiCharactersApi } from './api';

export function AICharacterDetail(
  props: ConsoleController & {
    job: AICharacterView;
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
  const [view, setView] = useState<'settings' | 'activity'>('settings');
  const initializedAgent = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Polling updates must not replace an in-progress editor draft.
    if (initializedAgent.current === job.id) return;
    initializedAgent.current = job.id;
    openAgentEditor(job);
    setView('settings');
  }, [job, openAgentEditor]);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const state = aiCharacterPresentation(job);
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
          {!aiCharacterPermissions(job).chat
            ? '发送聊天已关闭，AI 角色不会发送文字或语音回复。可在控制台安排任务和查看进展。'
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
            下线 AI 角色
          </button>
        ) : (
          <button
            disabled={disabled || capacityFull}
            onClick={() => void joinAgent(job)}
          >
            上线 AI 角色
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
        <div
          className="agents-confirm"
          role="group"
          aria-label="确认下线 AI 角色"
        >
          <p>AI 角色下线后将停止交流与任务执行，AI 角色设置和任务进度保留。</p>
          <div className="agents-actions">
            <button
              disabled={disabled}
              onClick={() => {
                setConfirmLeave(false);
                void stopAgent(job);
              }}
            >
              确认下线
            </button>
            <button onClick={() => setConfirmLeave(false)}>取消</button>
          </div>
        </div>
      )}
      <nav className="agents-detail-nav" aria-label="AI 角色工作区分类">
        <button
          aria-pressed={editing}
          disabled={disabled}
          onClick={() => openAgentEditor(job)}
        >
          AI 角色设置
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
        <AICharacterForm {...props} disabled={disabled || !state.canEdit} />
      ) : (
        <AICharacterLogViewer
          job={job}
          disabled={disabled}
          onUpdated={async () =>
            props.setJobs(await aiCharactersApi.listAgents())
          }
        />
      )}
    </article>
  );
}

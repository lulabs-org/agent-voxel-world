import type { AICharacterView } from '@voxel/shared';
import { aiCharacterPermissions } from '@voxel/shared';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../i18n/context';
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
  const { t } = useI18n();
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
    <article className="agents-detail" aria-label={t('console.characters.workspaceAria', { name: job.name })}>
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
            ? t('console.characters.presenceBarChatOff')
            : state.online
              ? t('console.characters.presenceBarOnline')
              : t('console.characters.presenceBarOffline')}
        </p>
        {state.occupiesSlot ? (
          <button
            className="agents-text-button"
            disabled={disabled || job.status === 'stopping'}
            onClick={() => setConfirmLeave(true)}
          >
            {t('console.characters.offlineButton')}
          </button>
        ) : (
          <button
            disabled={disabled || capacityFull}
            onClick={() => void joinAgent(job)}
          >
            {t('console.characters.onlineButton')}
          </button>
        )}
      </div>
      {job.status === 'failed' && (
        <p role="alert" className="agent-error">
          {t('console.characters.lastRunFailed', {
            reason: job.logs.at(-1) || t('console.characters.checkConnectionModelHint'),
          })}
        </p>
      )}
      {confirmLeave && (
        <div
          className="agents-confirm"
          role="group"
          aria-label={t('console.characters.confirmLeaveAria')}
        >
          <p>{t('console.characters.confirmLeaveDesc')}</p>
          <div className="agents-actions">
            <button
              disabled={disabled}
              onClick={() => {
                setConfirmLeave(false);
                void stopAgent(job);
              }}
            >
              {t('console.characters.confirmLeaveButton')}
            </button>
            <button onClick={() => setConfirmLeave(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
      <nav className="agents-detail-nav" aria-label={t('console.characters.navAria')}>
        <button
          aria-pressed={editing}
          disabled={disabled}
          onClick={() => openAgentEditor(job)}
        >
          {t('console.characters.tabSettings')}
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
          {t('console.characters.tabActivity')}
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

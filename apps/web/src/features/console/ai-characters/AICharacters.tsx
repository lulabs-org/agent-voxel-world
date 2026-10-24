import { AICharacterSidebar } from './list/AICharacterSidebar';
import { ConsoleFeedbackRelay } from '../../../components/ui/ConsoleFeedbackRelay';
import './ai-characters.css';
import { useI18n } from '../../../i18n/context';
import type { AICharactersProps } from './types';
import { AICharacterDetail } from './detail/AICharacterDetail';
import { AICharacterForm } from './editor/AICharacterForm';
import { aiCharacterPresentation } from './presentation/agent-presentation';

export function AICharacters(props: AICharactersProps) {
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
  const creating = showAgentForm && !editingAgent;
  const current = jobs.find((job) => job.id === selectedAgentId) ?? jobs[0];
  const onlineCount = jobs.filter(
    (job) => aiCharacterPresentation(job).occupiesSlot,
  ).length;
  const disabled = busy || loadingJobs || !!pollError;
  return (
    <section
      className="agents-workspace"
      aria-label={t('console.characters.managementAria')}
    >
      <ConsoleFeedbackRelay
        active={props.active}
        error={
          pollError
            ? t('console.characters.pollErrorHint', { error: pollError })
            : ''
        }
      />
      <div className="agents-layout console-columns">
        <AICharacterSidebar
          jobs={jobs}
          loadingJobs={loadingJobs}
          onlineCount={onlineCount}
          disabled={disabled}
          openAgentEditor={openAgentEditor}
          busy={busy}
          creating={creating}
          current={current}
          showAgentForm={showAgentForm}
          editingAgent={editingAgent}
        />
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

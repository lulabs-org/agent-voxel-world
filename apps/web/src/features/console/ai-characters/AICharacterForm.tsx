import { useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import {
  AI_CHARACTER_PERMISSIONS,
  AI_CHARACTER_ROLE_DESCRIPTION_LIMIT,
  AI_CHARACTER_SKILLS,
  aiCharacterPermissions,
} from '@voxel/shared';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  Cpu,
  Gauge,
  Info,
  Loader2,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  UserCog,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useI18n } from '../../../i18n/context';
import { TaskBudgetFields } from '../execution/TaskBudgetFields';
import type { ConsoleController } from '../useConsoleController';
import { DeleteAICharacterDialog } from './DeleteAICharacterDialog';
import { aiCharacterPresentation } from './presentation/agent-presentation';

export function AICharacterForm(
  props: ConsoleController & { disabled: boolean },
) {
  const { t } = useI18n();
  const {
    providers,
    voiceServices,
    agent,
    setAgent,
    editingAgent,
    setShowAgentForm,
    busy,
    notice,
    setNotice,
    setError,
    selected,
    chooseProvider,
    saveAgent,
    disabled,
    joinOnCreate,
    setJoinOnCreate,
    jobs,
    toggleVoiceReplies,
    deleteAgent,
    error,
  } = props;

  const [confirmDelete, setConfirmDelete] = useState(false);
  const permissions = aiCharacterPermissions(agent);
  const current = jobs.find((job) => job.id === editingAgent);
  const running = current && !aiCharacterPresentation(current).canEdit;

  const cancel = () => {
    setShowAgentForm(false);
    setError('');
    setNotice('');
  };

  const validProvider =
    selected &&
    selected.defaultModel.trim() &&
    (selected.type === 'ollama' || selected.hasApiKey);

  return (
    <section className="agents-profile">
      <div className="agents-form-heading">
        <div>
          <h4>
            {editingAgent ? (
              <UserCog size={18} className="agents-heading-icon" />
            ) : (
              <Bot size={18} className="agents-heading-icon" />
            )}
            {editingAgent
              ? t('console.characters.headingEdit')
              : t('console.characters.headingCreate')}
          </h4>
          <p>
            {editingAgent
              ? t('console.characters.headingEditDesc')
              : t('console.characters.headingCreateDesc')}
          </p>
        </div>
        {!editingAgent && (
          <button
            type="button"
            disabled={busy}
            onClick={cancel}
            className="agents-btn-icon"
          >
            <ArrowLeft size={14} />
            {t('common.back')}
          </button>
        )}
      </div>

      {running && (
        <div className="agents-confirm agents-running-banner">
          <div className="agents-banner-text">
            <AlertCircle size={16} className="agents-banner-icon" />
            <p>
              {aiCharacterPresentation(current).transitioning
                ? t('console.characters.bannerTransitioning')
                : t('console.characters.bannerRunning')}
            </p>
          </div>
          {current.voiceServiceId &&
            aiCharacterPermissions(current).chat &&
            !aiCharacterPresentation(current).transitioning && (
              <button
                type="button"
                disabled={busy || !!props.pollError}
                onClick={() => {
                  void toggleVoiceReplies(current);
                }}
                className="agents-btn-icon"
              >
                {current.voiceReplies ? (
                  <>
                    <VolumeX size={14} />
                    {t('console.characters.disableVoiceReplies')}
                  </>
                ) : (
                  <>
                    <Volume2 size={14} />
                    {t('console.characters.enableVoiceReplies')}
                  </>
                )}
              </button>
            )}
        </div>
      )}

      <form
        className="agent-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void saveAgent();
        }}
      >
        <fieldset disabled={disabled}>
          <div className="agent-grid">
            <label>
              <span className="agents-field-label">
                <User size={13} className="agents-field-icon" />
                {t('console.characters.nameLabel')}
              </span>
              <input
                autoFocus={!editingAgent}
                required
                maxLength={24}
                value={agent.name}
                placeholder={t('console.characters.namePlaceholder')}
                onChange={(event) =>
                  setAgent({ ...agent, name: event.target.value })
                }
              />
            </label>
            <label>
              <span className="agents-field-label">
                <Cpu size={13} className="agents-field-icon" />
                {t('console.characters.providerLabel')}
              </span>
              <select
                required
                value={agent.providerId}
                onChange={(event) => chooseProvider(event.target.value)}
              >
                <option value="" disabled>
                  {t('console.characters.providerSelectPlaceholder')}
                </option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name} ·{' '}
                    {provider.defaultModel ||
                      t('console.characters.providerNoModel')}
                    {provider.type !== 'ollama' && !provider.hasApiKey
                      ? ` · ${t('console.characters.providerNoKey')}`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="agent-hint">
            <Info size={12} className="agents-hint-icon" />
            {t('console.characters.providerHint')}
          </p>

          {!validProvider && (
            <div className="agents-form-alert warning">
              <AlertTriangle size={14} className="agents-alert-icon" />
              <span>
                {!selected
                  ? t('console.characters.providerWarningNone')
                  : !selected.defaultModel.trim()
                    ? t('console.characters.providerWarningNoModel')
                    : t('console.characters.providerWarningNoKey')}
              </span>
            </div>
          )}

          <label className="agents-role-field">
            <span className="agents-field-label">
              <Sparkles size={13} className="agents-field-icon" />
              {t('console.characters.roleDescriptionLabel')}
            </span>
            <textarea
              rows={4}
              maxLength={AI_CHARACTER_ROLE_DESCRIPTION_LIMIT}
              value={agent.roleDescription ?? ''}
              placeholder={t('console.characters.roleDescriptionPlaceholder')}
              aria-describedby="agent-role-hint"
              onChange={(event) =>
                setAgent({ ...agent, roleDescription: event.target.value })
              }
            />
          </label>
          <p className="agent-hint agents-role-meta" id="agent-role-hint">
            <span>{t('console.characters.roleDescriptionHint')}</span>
            <span className="agents-role-count">
              {(agent.roleDescription ?? '').length} /{' '}
              {AI_CHARACTER_ROLE_DESCRIPTION_LIMIT}
            </span>
          </p>

          <div className="agents-form-section">
            <h4>
              <Sparkles size={14} />
              {t('console.characters.skillsSectionTitle')}
            </h4>
            <p className="agent-hint">
              {t('console.characters.skillsSectionHint')}
            </p>
            <div className="agents-capability-grid">
              {AI_CHARACTER_SKILLS.map((skill) => {
                const checked = agent.skills?.includes(skill.id) ?? false;
                const missing = skill.requires.filter((id) => !permissions[id]);

                return (
                  <label
                    key={skill.id}
                    className={`agent-check agents-permission agents-capability-card${checked ? ' is-checked' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        setAgent({
                          ...agent,
                          skills: event.target.checked
                            ? [...(agent.skills ?? []), skill.id]
                            : (agent.skills ?? []).filter(
                                (id) => id !== skill.id,
                              ),
                        })
                      }
                    />
                    <span className="agents-capability-body">
                      <strong className="agents-capability-name">
                        {skill.name}
                      </strong>
                      <small className="agents-capability-desc">
                        {skill.description}
                      </small>
                      <small className="agents-capability-requires">
                        {t('console.characters.requiredPermissions')}
                        {skill.requires
                          .map(
                            (id) =>
                              AI_CHARACTER_PERMISSIONS.find((p) => p.id === id)!
                                .name,
                          )
                          .join(', ')}
                      </small>
                      {checked && missing.length > 0 && (
                        <small className="agents-capability-warning">
                          <AlertTriangle
                            size={12}
                            className="agents-warning-icon"
                          />
                          {t('console.characters.restrictedExecution', {
                            missing: missing
                              .map(
                                (id) =>
                                  AI_CHARACTER_PERMISSIONS.find(
                                    (p) => p.id === id,
                                  )!.name,
                              )
                              .join(', '),
                          })}
                        </small>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="agents-form-section">
            <h4>
              <ShieldCheck size={14} />
              {t('console.characters.actionsSectionTitle')}
            </h4>
            <p className="agent-hint">
              {t('console.characters.actionsSectionHint')}
            </p>
            <div className="agents-capability-grid">
              {AI_CHARACTER_PERMISSIONS.map((permission) => {
                const isChecked = !!permissions[permission.id];

                return (
                  <label
                    key={permission.id}
                    className={`agent-check agents-permission agents-capability-card${isChecked ? ' is-checked' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(event) => {
                        const next = {
                          ...permissions,
                          [permission.id]: event.target.checked,
                        };
                        setAgent({
                          ...agent,
                          permissions: next,
                          allowEdits: next.place && next.remove,
                        });
                      }}
                    />
                    <span className="agents-capability-body">
                      <strong className="agents-capability-name">
                        {permission.name}
                      </strong>
                      <small className="agents-capability-desc">
                        {permission.description}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="agents-form-section agents-voice-settings">
            <div className="agents-toggle-card">
              <div className="agents-toggle-info">
                <strong>
                  <Volume2 size={15} />
                  {t('console.characters.voiceReplySectionTitle')}
                </strong>
                <small>{t('console.characters.voiceReplySectionDesc')}</small>
              </div>
              <Switch.Root
                id="voice-reply-switch"
                className="agents-switch-root"
                aria-label={t('console.characters.voiceReplySwitchAria')}
                checked={!!agent.voiceReplies}
                disabled={!permissions.chat || voiceServices.length === 0}
                onCheckedChange={(checked) =>
                  setAgent({
                    ...agent,
                    voiceReplies: checked,
                    voiceServiceId: checked
                      ? voiceServices.find(
                          (service) => service.id === agent.voiceServiceId,
                        )?.id ||
                        voiceServices[0]?.id ||
                        ''
                      : agent.voiceServiceId,
                  })
                }
              >
                <Switch.Thumb className="agents-switch-thumb" />
              </Switch.Root>
            </div>

            {!permissions.chat ? (
              <p className="agents-voice-status" role="status">
                {t('console.characters.voiceReplyChatOff')}
              </p>
            ) : voiceServices.length === 0 ? (
              <p className="agents-voice-status" role="status">
                {t('console.characters.voiceReplyNoServices')}
              </p>
            ) : agent.voiceReplies ? (
              <div className="agents-voice-picker">
                <label className="agents-voice-service">
                  {t('console.characters.voiceSelectLabel')}
                  <select
                    value={agent.voiceServiceId || ''}
                    required
                    onChange={(event) =>
                      setAgent({
                        ...agent,
                        voiceServiceId: event.target.value,
                      })
                    }
                  >
                    {!voiceServices.some(
                      (service) => service.id === agent.voiceServiceId,
                    ) && (
                      <option value={agent.voiceServiceId || ''} disabled>
                        {t('console.characters.voiceSelectPlaceholder')}
                      </option>
                    )}
                    {voiceServices.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name} ·{' '}
                        {service.voice ||
                          t('console.characters.voiceAutoLabel')}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <p className="agents-voice-status">
                {t('console.characters.voiceReplyTextOnly')}
              </p>
            )}
          </div>

          <div className="agents-form-section agents-budget-settings">
            <div className="agents-toggle-card">
              <div className="agents-toggle-info">
                <strong>
                  <Gauge size={15} />
                  {t('console.characters.budgetSectionTitle')}
                </strong>
                <small>{t('console.characters.budgetSectionDesc')}</small>
              </div>
              <Switch.Root
                id="task-limits-switch"
                className="agents-switch-root"
                aria-label={t('console.characters.budgetSwitchAria')}
                checked={!!agent.taskLimitsEnabled}
                onCheckedChange={(checked) =>
                  setAgent({
                    ...agent,
                    taskLimitsEnabled: checked,
                  })
                }
              >
                <Switch.Thumb className="agents-switch-thumb" />
              </Switch.Root>
            </div>

            {agent.taskLimitsEnabled ? (
              <div className="agents-budget-content">
                <TaskBudgetFields
                  hideHeading
                  value={agent}
                  onChange={(limits) => setAgent({ ...agent, ...limits })}
                />
              </div>
            ) : (
              <p className="agents-budget-status">
                {t('console.characters.budgetDisabledStatus')}
              </p>
            )}
          </div>

          {!editingAgent && (
            <label className="agent-check agents-join-option">
              <input
                type="checkbox"
                checked={joinOnCreate}
                onChange={(e) => setJoinOnCreate(e.target.checked)}
              />
              <span>{t('console.characters.joinOnCreateLabel')}</span>
            </label>
          )}

          <div className="agents-form-footer">
            <div className="agents-footer-left">
              {editingAgent && current && (
                <button
                  type="button"
                  className="agents-delete-button agents-btn-icon"
                  disabled={disabled || current.status === 'stopping'}
                  onClick={() => {
                    setError('');
                    setConfirmDelete(true);
                  }}
                >
                  <Trash2 size={14} />
                  {t('console.characters.deleteButton')}
                </button>
              )}
            </div>
            <div className="agents-footer-right">
              {notice && (
                <span className="agents-footer-saved-hint" role="status">
                  <Check size={14} />
                  {t('common.saved')}
                </span>
              )}
              <button
                type="button"
                onClick={cancel}
                className="agents-btn-icon"
              >
                <ArrowLeft size={14} />
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="primary agents-btn-icon"
                onClick={() => void saveAgent()}
                disabled={
                  !validProvider ||
                  !agent.name.trim() ||
                  (!editingAgent &&
                    joinOnCreate &&
                    props.jobs.filter(
                      (j) => aiCharacterPresentation(j).occupiesSlot,
                    ).length >= 4)
                }
              >
                {busy ? (
                  <>
                    <Loader2 size={14} className="agents-spin" />
                    {t('console.characters.saving')}
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    {editingAgent
                      ? t('console.characters.saveSettings')
                      : joinOnCreate
                        ? t('console.characters.createAndJoin')
                        : t('console.characters.createCharacter')}
                  </>
                )}
              </button>
            </div>
          </div>
        </fieldset>
      </form>

      {confirmDelete && current && (
        <DeleteAICharacterDialog
          name={current.name}
          busy={busy}
          disabled={disabled || current.status === 'stopping'}
          error={error}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void deleteAgent(current)}
        />
      )}
    </section>
  );
}

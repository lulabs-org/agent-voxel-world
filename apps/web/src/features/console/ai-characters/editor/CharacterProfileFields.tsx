import { useI18n } from '../../../../i18n/context';
import type { AICharacterFormProps } from './types';
import { AI_CHARACTER_ROLE_DESCRIPTION_LIMIT } from '@voxel/shared';
import { User, Cpu, Info, AlertTriangle, Sparkles } from 'lucide-react';
export function CharacterProfileFields({
  agent,
  setAgent,
  editingAgent,
  providers,
  selected,
  chooseProvider,
  validProvider,
}: Pick<
  AICharacterFormProps,
  | 'agent'
  | 'setAgent'
  | 'editingAgent'
  | 'providers'
  | 'selected'
  | 'chooseProvider'
> & { validProvider: boolean }) {
  const { t } = useI18n();
  return (
    <>
      {' '}
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
    </>
  );
}

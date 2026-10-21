import { useI18n } from '../../../i18n/context';
import type { ChatController } from '../hooks/useChatController';

type Props = Pick<
  ChatController,
  | 'connection'
  | 'scope'
  | 'recipients'
  | 'picker'
  | 'setPicker'
  | 'setChoice'
  | 'search'
  | 'input'
  | 'candidates'
  | 'activeChoice'
  | 'select'
  | 'onKey'
>;

export function MentionPicker({
  connection,
  scope,
  recipients,
  picker,
  setPicker,
  setChoice,
  search,
  input,
  candidates,
  activeChoice,
  select,
  onKey,
}: Props) {
  const { t } = useI18n();
  if (!picker) return null;
  return (
    <div className="mention-picker">
      <div className="mention-heading">
        <strong>
          {scope === 'private'
            ? t('chat.mentionTitlePrivate')
            : t('chat.mentionTitlePublic')}
        </strong>
        <small>{t('chat.mentionSelectedCount', { count: recipients.length })}</small>
        <button
          type="button"
          aria-label={t('chat.closeMentionAria')}
          onClick={() => {
            setPicker(null);
            input.current?.focus();
          }}
        >
          ×
        </button>
      </div>
      {picker.source === 'button' && (
        <input
          ref={search}
          className="mention-search"
          aria-label={t('chat.searchMentionAria')}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={true}
          aria-controls="chat-mentions"
          aria-activedescendant={
            candidates.length
              ? `mention-${candidates[activeChoice].id}`
              : undefined
          }
          placeholder={t('chat.searchMentionPlaceholder')}
          value={picker.query}
          onKeyDown={onKey}
          onChange={(e) => {
            setPicker({ source: 'button', query: e.target.value });
            setChoice(0);
          }}
        />
      )}
      <div
        id="chat-mentions"
        className="mention-list"
        role="listbox"
        aria-label={t('chat.selectRecipientAria')}
      >
        {candidates.length ? (
          candidates.map((p, i) => (
            <button
              type="button"
              role="option"
              id={`mention-${p.id}`}
              aria-selected={activeChoice === i}
              key={p.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(p)}
            >
              <span
                className={`mention-avatar ${p.kind === 'human' ? 'human' : 'agent'}`}
                aria-hidden="true"
              >
                {p.kind === 'human' ? '●' : '◇'}
              </span>
              <span className="mention-name">
                {p.name}
                <small>
                  {p.kind === 'human' ? t('worldPanel.player') : t('avatar.agent')} ·{' '}
                  {t('chat.onlineTag')}
                  {connection.players.filter((other) => other.name === p.name)
                    .length > 1
                    ? ` · ${p.id.slice(-4)}`
                    : ''}
                </small>
              </span>
              <span className="mention-pick" aria-hidden="true">
                ↵
              </span>
            </button>
          ))
        ) : (
          <p className="mention-empty">
            {picker.query.trim()
              ? t('chat.noMatchFound')
              : t('chat.noOnlineUsers')}
            <small>{t('chat.removeRecipientHint')}</small>
          </p>
        )}
      </div>
      <div className="mention-hint">{t('chat.mentionKeyboardHint')}</div>
    </div>
  );
}

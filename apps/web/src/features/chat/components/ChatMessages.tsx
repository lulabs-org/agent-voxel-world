import { useI18n } from '../../../i18n/context';
import type { ChatController } from '../hooks/useChatController';
import { AudioMessage } from './AudioMessage';

type Props = Pick<
  ChatController,
  'connection' | 'text' | 'scope' | 'recipients' | 'list'
>;

export function ChatMessages({ connection, list }: Props) {
  const { t } = useI18n();
  return (
    <div className="messages" ref={list} aria-live="polite">
      {connection.chats.map((e) => (
        <article className="chat-message" key={e.seq}>
          <div>
            <strong>{e.data.name}</strong>{' '}
            <small>
              {e.data.scope === 'nearby'
                ? t('chat.nearbyTranscribe')
                : e.data.scope === 'private'
                  ? t('chat.private')
                  : t('chat.public')}
              {e.actor === connection.room?.sessionId ? t('worldPanel.you') : ''}
              {e.data.scope === 'private'
                ? ' → ' +
                  e.data.recipients
                    .map(
                      (id) =>
                        connection.players.find((p) => p.id === id)?.name ??
                        t('chat.offlineUser'),
                    )
                    .join(', ')
                : ''}
            </small>
          </div>
          {e.data.scope === 'public' && e.data.recipients.length > 0 && (
            <div className="chat-message-mentions">
              {e.data.recipients.map((id) => (
                <span key={id}>
                  @
                  {connection.players.find((p) => p.id === id)?.name ??
                    t('chat.offlineUser')}
                </span>
              ))}
            </div>
          )}
          {e.data.kind === 'audio' ? (
            <AudioMessage entry={e} connection={connection} />
          ) : (
            <p>{e.data.text}</p>
          )}
        </article>
      ))}
    </div>
  );
}

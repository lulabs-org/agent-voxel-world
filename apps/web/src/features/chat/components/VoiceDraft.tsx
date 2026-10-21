import { useI18n } from '../../../i18n/context';
import { AudioPlayer } from './AudioPlayer';

/** Local preview only: playing or seeking never uploads the recording. */
export function VoiceDraft({
  src,
  durationMs,
  busy,
  onDiscard,
}: {
  src: string;
  durationMs: number;
  busy: boolean;
  onDiscard: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="voice-draft" aria-label={t('chat.voiceDraftAria')}>
      <div className="voice-draft-heading">
        <strong>{t('chat.voiceDraftTitle')}</strong>
        <span>{busy ? t('chat.sendingStatus') : t('chat.readyToSend')}</span>
        <button
          type="button"
          className="voice-draft-discard"
          disabled={busy}
          onClick={onDiscard}
          aria-label={t('chat.discardRecording')}
          title={t('chat.discardRecording')}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" />
          </svg>
        </button>
      </div>
      <AudioPlayer
        src={src}
        durationMs={durationMs}
        busy={busy}
        label={t('chat.previewVoice')}
        idleLabel={t('chat.onlyYouCanHear')}
        playLabel={t('chat.playRecording')}
        pauseLabel={t('chat.pauseRecording')}
      />
    </section>
  );
}

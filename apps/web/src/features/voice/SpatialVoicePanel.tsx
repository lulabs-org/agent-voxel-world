import { useEffect, useRef, useState } from 'react';
import {
  SpatialTranscriber,
  SpatialVoice,
  type SpatialStatus,
  type TranscriptionState,
} from '../../audio';
import type { SpeechAnchor } from '../../graphics/speech-anchor';
import { useI18n } from '../../i18n';
import type { Connection } from '../../network/connection';
import { SpeechCaption } from './SpeechCaption';

export function SpatialVoicePanel({
  connection,
  speechAnchor,
  expanded,
  onExpandedChange,
  expandDisabled,
}: {
  connection: Connection;
  speechAnchor: (actor: string) => SpeechAnchor | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  expandDisabled: boolean;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<SpatialStatus>({
    sending: false,
    listening: false,
    pending: false,
    connected: 0,
    error: '',
  });
  const [transcript, setTranscript] = useState<TranscriptionState>({
    status: t('voice.autoTranscribe'),
    text: '',
    partial: '',
    error: '',
  });
  const engine = useRef<SpatialVoice | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const details = useRef<HTMLDivElement>(null);
  const wasExpanded = useRef(expanded);
  useEffect(() => {
    if (expanded)
      details.current?.querySelector<HTMLButtonElement>('button')?.focus();
    else if (wasExpanded.current) toggle.current?.focus();
    wasExpanded.current = expanded;
  }, [expanded]);
  useEffect(() => {
    const voice = new SpatialVoice(connection, setState);
    const transcriber = new SpatialTranscriber(
      () => connection.chatToken,
      setTranscript,
    );
    voice.onMicrophone = (stream) => {
      if (stream) void transcriber.start(stream);
      else transcriber.stop();
    };
    engine.current = voice;
    connection.onSpatialSignal = voice.signal;
    connection.onAgentSpeech = voice.agentSpeech.receive;
    connection.stopSpatialInput = voice.stopMic;
    const unload = () => voice.dispose();
    window.addEventListener('pagehide', unload);
    return () => {
      window.removeEventListener('pagehide', unload);
      connection.onSpatialSignal = () => {};
      connection.onAgentSpeech = () => {};
      connection.stopSpatialInput = () => {};
      voice.dispose();
      transcriber.stop();
      engine.current = null;
    };
  }, [connection]);
  useEffect(() => {
    engine.current?.update();
  }, [connection.players, connection.status]);
  const micButton = (
    <button
      aria-label={
        state.pending
          ? t('voice.micCancelPending')
          : state.sending
            ? t('voice.micTurnOff')
            : t('voice.micTurnOn')
      }
      aria-pressed={state.sending}
      className={state.sending ? 'mic-live' : ''}
      disabled={connection.status !== 'connected' || connection.chatRecording}
      onClick={() =>
        state.sending || state.pending
          ? engine.current?.stopMic()
          : void engine.current?.startMic()
      }
    >
      {state.pending
        ? t('voice.micPending')
        : state.sending
          ? t('voice.micOn')
          : t('voice.micOff')}
    </button>
  );
  const listenButton = (
    <button
      aria-label={state.listening ? t('voice.listenOff') : t('voice.listenOn')}
      aria-pressed={state.listening}
      disabled={connection.status !== 'connected'}
      onClick={() => void engine.current?.setListening(!state.listening)}
    >
      {state.listening ? t('voice.listenActive') : t('voice.listenInactive')}
    </button>
  );
  return (
    <>
      <SpeechCaption speech={state.agentSpeaking} anchor={speechAnchor} />
      <section
        className={`spatial-voice${expanded ? ' is-expanded' : ''}`}
        aria-label={t('voice.spatialAria')}
        data-hud
      >
        <div
          ref={details}
          className="spatial-details"
          hidden={!expanded}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              onExpandedChange(false);
            }
          }}
        >
          <div className="chat-title">
            <strong>{t('voice.title')}</strong>
            <button
              aria-label={t('voice.collapseDetails')}
              onClick={() => onExpandedChange(false)}
            >
              ×
            </button>
          </div>
          <small>{t('voice.spatialDesc', { count: state.connected })}</small>
          <small>{t('voice.whisperHint')}</small>
          <small role="status">{transcript.status}</small>
          {transcript.text && (
            <p className="spatial-caption">{transcript.text}</p>
          )}
          {(state.error || transcript.error) && (
            <p role="alert" className="chat-error">
              {state.error || transcript.error}
            </p>
          )}
        </div>
        {transcript.partial && (
          <div className="spatial-live-caption" role="status">
            {transcript.partial && (
              <span>
                {t('voice.interimCaption', { text: transcript.partial })}
              </span>
            )}
          </div>
        )}
        {!expanded && (state.error || transcript.error) && (
          <button
            className="spatial-error-summary"
            aria-label={t('voice.voiceIssueSummary')}
            disabled={expandDisabled}
            onClick={() => onExpandedChange(true)}
          >
            <span role="status">{t('voice.voiceIssueSummary')}</span>
          </button>
        )}
        <div className="spatial-toolbar">
          {micButton}
          {listenButton}
          <button
            ref={toggle}
            aria-label={
              expanded ? t('voice.collapseDetails') : t('voice.expandToggle')
            }
            aria-expanded={expanded}
            disabled={!expanded && expandDisabled}
            onClick={() => onExpandedChange(!expanded)}
          >
            {expanded ? '⌄' : '⌃'}
          </button>
        </div>
      </section>
    </>
  );
}


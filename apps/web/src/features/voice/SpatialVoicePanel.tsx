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
}: {
  connection: Connection;
  speechAnchor: (actor: string) => SpeechAnchor | null;
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
      connection.onSpatialSignal = () => { };
      connection.onAgentSpeech = () => { };
      connection.stopSpatialInput = () => { };
      voice.dispose();
      transcriber.stop();
      engine.current = null;
    };
  }, [connection]);
  useEffect(() => {
    engine.current?.update();
  }, [connection.players, connection.status]);
  return (
    <>
      <SpeechCaption speech={state.agentSpeaking} anchor={speechAnchor} />
      <section
        className="spatial-voice"
        aria-label={t('voice.spatialAria')}
        data-hud
      >
        {(transcript.partial || transcript.text) && (
          <div className="spatial-live-caption" role="status">
            {transcript.partial ? (
              <span>
                {t('voice.interimCaption', { text: transcript.partial })}
              </span>
            ) : (
              <span>{transcript.text}</span>
            )}
          </div>
        )}
        {(state.error || transcript.error) && (
          <p role="alert" className="spatial-error-summary">
            {state.error || transcript.error}
          </p>
        )}
        <div className="spatial-toolbar">
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
          <button
            aria-label={
              state.listening ? t('voice.listenOff') : t('voice.listenOn')
            }
            aria-pressed={state.listening}
            disabled={connection.status !== 'connected'}
            onClick={() => void engine.current?.setListening(!state.listening)}
          >
            {state.listening ? t('voice.listenActive') : t('voice.listenInactive')}
          </button>
        </div>
      </section>
    </>
  );
}

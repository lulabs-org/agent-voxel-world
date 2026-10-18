import { useEffect, useRef, useState } from 'react';
import type { Connection } from '../../network/connection';
import { SpatialVoice, type SpatialStatus } from '../../audio/spatial-voice';
import {
  SpatialTranscriber,
  type TranscriptionState,
} from '../../audio/spatial-transcriber';
export function SpatialVoicePanel({
  connection,
  expanded,
  onExpandedChange,
  expandDisabled,
}: {
  connection: Connection;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  expandDisabled: boolean;
}) {
  const [state, setState] = useState<SpatialStatus>({
    sending: false,
    listening: false,
    pending: false,
    connected: 0,
    error: '',
  });
  const [transcript, setTranscript] = useState<TranscriptionState>({
    status: '麦克风开启时自动转写',
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
          ? '取消开启麦克风'
          : state.sending
            ? '关闭麦克风'
            : '开启麦克风'
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
        ? '授权中 · 取消'
        : state.sending
          ? '● 麦克风开'
          : '麦克风关'}
    </button>
  );
  const listenButton = (
    <button
      aria-label={state.listening ? '关闭收听' : '开启收听'}
      aria-pressed={state.listening}
      disabled={connection.status !== 'connected'}
      onClick={() => void engine.current?.setListening(!state.listening)}
    >
      {state.listening ? '收听开' : '收听关'}
    </button>
  );
  return (
    <section
      className={`spatial-voice${expanded ? ' is-expanded' : ''}`}
      aria-label="附近空间语音"
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
          <strong>附近语音</strong>
          <button
            aria-label="收起附近语音"
            onClick={() => onExpandedChange(false)}
          >
            ×
          </button>
        </div>
        <small>18 格内随距离、朝向变化 · {state.connected} 个语音连接</small>
        <small>整句确认后附近 Agent 才会收到；私聊语音仅接收者可听。</small>
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
      {(state.agentSpeaking || transcript.partial) && (
        <div className="spatial-live-caption" role="status">
          {state.agentSpeaking && <span>正在说话 · {state.agentSpeaking}</span>}
          {transcript.partial && <span>临时字幕 · {transcript.partial}</span>}
        </div>
      )}
      {!expanded && (state.error || transcript.error) && (
        <button
          className="spatial-error-summary"
          aria-label="语音异常 · 查看详情"
          disabled={expandDisabled}
          onClick={() => onExpandedChange(true)}
        >
          <span role="status">语音异常 · 查看详情</span>
        </button>
      )}
      <div className="spatial-toolbar">
        {micButton}
        {listenButton}
        <button
          ref={toggle}
          aria-label={expanded ? '收起附近语音' : '展开附近语音'}
          aria-expanded={expanded}
          disabled={!expanded && expandDisabled}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? '⌄' : '⌃'}
        </button>
      </div>
    </section>
  );
}

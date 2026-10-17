import { useEffect, useId, useRef, useState } from 'react';
import {
  LocalRecorder,
  type SpeechCapabilities,
} from '../../audio/local-recorder';
import { LiveSpeechSession, speechTransport } from '../../audio/live-speech';
import { LiveRecorder } from '../../audio/live-recorder';
import type { Connection } from '../../network/connection';
import { voiceApi } from './api';
import { BailianAsrConfig } from './BailianAsrConfig';
import { BailianSpeechSession } from '../../audio/bailian-speech';
import { browserLanguages } from './browser-asr-languages';
import { useAsrServices } from './useAsrServices';
import { BrowserRecognitionSession } from '../../audio/browser-recognition';

const serverLanguages = [
  ['zh-CN', '中文'],
  ['en-US', '英语'],
] as const;

export function SpeechRecognitionPanel({
  active,
  connection,
}: {
  active: boolean;
  connection: Connection;
}) {
  const [recorder] = useState(() => new LocalRecorder());
  const [live] = useState(() => new LiveRecorder());
  const [browser] = useState(() => new BrowserRecognitionSession());
  const asr = useAsrServices(active);
  const service = asr.id;
  const isBrowser = asr.draft.provider === 'browser';
  const isWhisper = asr.draft.provider === 'whisper';
  const whisperServiceId =
    asr.selected?.provider === 'whisper' ? service : undefined;
  const fileTestId = useId();
  const [showFileTest, setShowFileTest] = useState(false);
  const [partial, setPartial] = useState('');
  const [capabilities, setCapabilities] = useState<SpeechCapabilities>();
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [checkedAt, setCheckedAt] = useState<Date>();
  const [retry, setRetry] = useState(0);
  const [serverLanguage, setServerLanguage] = useState('zh-CN');
  const language =
    asr.draft.provider === 'browser' ? asr.draft.language : serverLanguage;
  const [state, setState] = useState<'idle' | 'listening' | 'thinking'>('idle');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const ownsMicrophone = useRef(false);
  const release = () => {
    if (ownsMicrophone.current) connection.voiceLabRecording = false;
    ownsMicrophone.current = false;
  };
  const stop = () => {
    recorder.cancel();
    live.cancel();
    browser.cancel();
    setPartial('');
    release();
    setState('idle');
    setStatus('已停止识别。');
  };
  useEffect(() => {
    setShowFileTest(false);
    setState('idle');
    setStatus('');
    return () => {
      recorder.cancel();
      live.cancel();
      browser.cancel();
      setPartial('');
      release();
    };
  }, [active, connection, recorder, live, browser, service]);
  useEffect(() => {
    if (!active || !isWhisper) return;
    const abort = new AbortController();
    setChecking(true);
    setCheckError('');
    setCheckedAt(undefined);
    setCapabilities(undefined);
    const timeout = setTimeout(() => {
      abort.abort();
      setChecking(false);
      setCheckError('检查超时，请确认项目服务正在运行后重试。');
      setCheckedAt(new Date());
    }, 10000);
    void voiceApi
      .capabilities(abort.signal, whisperServiceId)
      .then((value) => {
        if (!abort.signal.aborted) setCapabilities(value);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setCheckError('无法连接语音识别服务，请确认项目服务正在运行。');
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!abort.signal.aborted) {
          setChecking(false);
          setCheckedAt(new Date());
        }
      });
    return () => {
      clearTimeout(timeout);
      abort.abort();
    };
  }, [
    active,
    isWhisper,
    retry,
    whisperServiceId,
    asr.selected && asr.selected.provider !== 'browser'
      ? asr.selected.model
      : undefined,
  ]);
  const busy = state !== 'idle';
  const ready =
    active &&
    !!asr.selected &&
    !asr.dirty &&
    !asr.saving &&
    (isBrowser
      ? browser.available
      : asr.loaded &&
        !asr.loading &&
        (asr.selected.provider === 'whisper'
          ? capabilities?.local.available && !checking && !checkError
          : asr.selected.provider !== 'browser' && asr.selected.hasApiKey));
  const chooseService = (id: string) => {
    if (id === service) return;
    stop();
    asr.choose(id);
    setError('');
    setStatus('');
    setText('');
  };
  const start = (file?: File) => {
    if (!ready || busy) return;
    setError('');
    if (!file) {
      if (connection.chatRecording || connection.voiceLabRecording) {
        setError('麦克风正被其他录音使用，请结束录音后重试。');
        return;
      }
      connection.stopSpatialInput();
      connection.voiceLabRecording = true;
      ownsMicrophone.current = true;
    }
    setText('');
    const callbacks = {
      onState: (next: 'listening' | 'thinking', message: string) => {
        setState(next);
        setStatus(message);
      },
      onText: (value: string) => {
        release();
        setText(value);
        setState('idle');
        setStatus('识别完成，结果仅显示在这里。');
      },
      onError: (message: string) => {
        release();
        setState('idle');
        setStatus('');
        setError(message);
      },
    };
    if (isBrowser) {
      setState('listening');
      browser.start(language, {
        onStatus: setStatus,
        onPartial: setPartial,
        onFinal: (value) =>
          setText((previous) => (previous + '\n' + value).trim().slice(-4000)),
        onError: callbacks.onError,
        onEnd: () => {
          release();
          setState('idle');
          setStatus('浏览器识别已结束，已保留确认文字；可重新开始录音。');
        },
      });
    } else if (file)
      void recorder.transcribeFile(file, language, callbacks, whisperServiceId);
    else
      void live.start(
        language,
        {
          onState: callbacks.onState,
          onStatus: setStatus,
          onPartial: setPartial,
          onFinal: (value) =>
            setText((previous) =>
              (previous + '\n' + value).trim().slice(-4000),
            ),
          onError: callbacks.onError,
          onEnd: () => {
            release();
            setState('idle');
            setStatus('录音已结束，整句已确认。结果仅显示在这里。');
          },
        },
        undefined,
        undefined,
        !isWhisper
          ? (events) => new BailianSpeechSession(service, language, events)
          : whisperServiceId
            ? (events) =>
                new LiveSpeechSession(
                  speechTransport(
                    language,
                    undefined,
                    undefined,
                    whisperServiceId,
                  ),
                  events,
                )
            : undefined,
      );
  };
  return (
    <section aria-label="语音识别（ASR）">
      <div className="voice-services-layout">
        <aside className="agent-sidebar" aria-label="识别服务列表">
          <h3>识别服务</h3>
          <button
            type="button"
            aria-pressed={service === 'new'}
            disabled={busy || asr.saving || !asr.canAdd}
            onClick={() => chooseService('new')}
          >
            ＋ 添加识别服务
          </button>
          {!asr.loading && asr.services.length === 0 && (
            <p className="agent-hint">暂无已保存的识别服务，请添加服务。</p>
          )}
          {asr.services
            .map((value) => ({
              id: value.id,
              name: value.name,
              detail:
                value.provider === 'browser'
                  ? `浏览器识别 · ${browserLanguages.find(([code]) => code === value.language)?.[1] ?? value.language} · 此浏览器保存`
                  : value.provider === 'whisper'
                    ? `Whisper · ${value.model === 'default' ? '默认模型' : value.model} · ${value.threads} 线程`
                    : `阿里云百炼 · ${value.model}`,
            }))
            .map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={service === item.id}
                disabled={busy || asr.saving}
                onClick={() => chooseService(item.id)}
              >
                {item.name}
                <small>{item.detail}</small>
              </button>
            ))}
          {asr.loading && (
            <p className="agent-hint" role="status">
              正在加载识别服务…
            </p>
          )}
          <p>同一服务商可保存多份模型配置。选择服务，在右侧配置并试用。</p>
        </aside>
        <div className="agent-form">
          {asr.error && (
            <p role="alert" className="agent-error">
              {asr.error}
            </p>
          )}
          {asr.notice && (
            <p role="status" className="agent-notice">
              {asr.notice}
            </p>
          )}
          <BailianAsrConfig
            manager={asr}
            disabled={busy}
            models={capabilities?.whisperModels}
          />
          {!isBrowser && asr.selected?.provider === 'whisper' && (
            <>
              <h3>Whisper 服务状态</h3>
              <p role="status" aria-live="polite" aria-atomic="true">
                {checking
                  ? '正在检查服务…'
                  : checkError
                    ? '服务连接失败'
                    : capabilities?.local.available
                      ? '服务器识别服务已就绪'
                      : '服务未就绪'}
                {!checking && checkedAt && (
                  <small className="asr-help">
                    {checkError ? '本次检查结束' : '检查完成'} ·{' '}
                    {checkedAt.toLocaleTimeString('zh-CN', { hour12: false })}
                  </small>
                )}
              </p>
              {checkError && (
                <p role="alert" className="agent-error">
                  {checkError}
                </p>
              )}
              {capabilities && (
                <p className="agent-hint">{capabilities.local.reason}</p>
              )}
              <div>
                <button
                  type="button"
                  disabled={checking || busy}
                  onClick={() => {
                    setChecking(true);
                    setRetry((value) => value + 1);
                  }}
                >
                  {checking ? '检查中…' : '重新检查'}
                </button>
              </div>
              <p className="agent-hint">
                聊天录音和附近语音也使用自托管
                Whisper。识别模型部署在服务器上，玩家无需安装。
              </p>
              {!capabilities?.local.available && (
                <p className="agent-hint">
                  服务未就绪时，可在服务器的项目目录运行{' '}
                  <code>pnpm voice:setup</code> 准备识别模型。
                </p>
              )}
            </>
          )}
          <section className="voice-preview" aria-label="语音识别试用">
            <h4>试用语音识别</h4>
            {!isBrowser && (
              <label>
                识别语言
                <select
                  value={language}
                  disabled={busy}
                  onChange={(event) => setServerLanguage(event.target.value)}
                >
                  {serverLanguages.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="voice-service-actions">
              <button
                type="button"
                disabled={!ready || busy || (!isBrowser && !live.canRecord)}
                onClick={() => start()}
              >
                开始录音
              </button>
              {!isBrowser && asr.selected?.provider === 'whisper' && (
                <button
                  type="button"
                  className="asr-file-toggle"
                  aria-expanded={showFileTest}
                  aria-controls={fileTestId}
                  disabled={busy}
                  onClick={() => setShowFileTest((value) => !value)}
                >
                  {showFileTest ? '收起文件测试' : '用音频文件测试'}
                </button>
              )}
              {state === 'listening' && (
                <button
                  type="button"
                  onClick={() => {
                    if (isBrowser) {
                      setState('thinking');
                      browser.finish();
                    } else void live.finish();
                  }}
                >
                  结束录音
                </button>
              )}
              {busy && (
                <button type="button" onClick={stop}>
                  取消识别
                </button>
              )}
            </div>
            {isBrowser && !browser.available && (
              <p role="alert" className="agent-error">
                当前浏览器不支持语音识别，或页面不是安全上下文。请使用支持
                SpeechRecognition 的浏览器，并通过 HTTPS 或 localhost 打开。
              </p>
            )}
            {!isBrowser && !live.canRecord && (
              <p className="agent-hint">
                当前浏览器无法录音。请使用支持 AudioWorklet 的浏览器并在 HTTPS
                或 localhost 下打开；Whisper 支持音频文件识别。
              </p>
            )}
            {!isBrowser && asr.selected?.provider === 'whisper' && (
              <div
                id={fileTestId}
                hidden={!showFileTest}
                className="asr-file-test"
              >
                <label>
                  选择音频文件（最长 20 秒 / 5 MiB）
                  <input
                    type="file"
                    accept=".wav,.webm,.mp4,.m4a,.ogg"
                    disabled={!ready || busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) start(file);
                    }}
                  />
                </label>
              </div>
            )}
            <small className="asr-help">
              {isBrowser
                ? '语音由浏览器直接识别，可能需要联网。'
                : !isWhisper
                  ? '录音经项目服务器实时转发至阿里云识别。'
                  : '录音或文件会发送到项目服务器识别。'}
              每次连续录音最长 5
              分钟；结束录音会等待最后的识别结果，取消会丢弃未确认内容。试用结果不会发送到聊天或触发
              Agent；切换页面或关闭控制台会停止录音和识别。
            </small>
            {status && <p role="status">{status}</p>}
            {error && (
              <p role="alert" className="agent-error">
                {error}
              </p>
            )}
            <div className="speech-interim" role="status" aria-live="polite">
              <strong>临时字幕 · 未确认</strong>
              <p>
                {partial ||
                  (state === 'listening'
                    ? '正在听取讲话…'
                    : '说话时在这里显示，停顿后确认')}
              </p>
            </div>
            <label>
              已确认文字
              <textarea
                rows={4}
                readOnly
                value={text}
                placeholder="每句确认后，文字会追加到这里"
              />
            </label>
          </section>
        </div>
      </div>
    </section>
  );
}

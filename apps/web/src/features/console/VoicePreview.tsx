import { useEffect, useId, useRef, useState } from 'react';
import type { VoiceServiceView } from '@voxel/shared';
import { speakBrowserText } from '../../audio/browser-tts';
import { consoleApi } from './api';
import { voicePreviewSamples } from './voice-preview-samples';

export function VoicePreview({
  serviceId,
  service,
  active,
  disabled = false,
}: {
  serviceId?: string;
  service?: VoiceServiceView;
  active: boolean;
  disabled?: boolean;
}) {
  const textId = useId();
  const [text, setText] = useState(voicePreviewSamples[0].text);
  const [language, setLanguage] = useState(voicePreviewSamples[0].language);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const request = useRef<AbortController | undefined>(undefined);
  const audio = useRef<HTMLAudioElement>(null);
  const stop = () => {
    request.current?.abort();
    audio.current?.pause();
    setUrl('');
    setBusy(false);
    setStatus('');
  };
  useEffect(() => {
    stop();
    return () => {
      request.current?.abort();
      audio.current?.pause();
    };
  }, [serviceId, active, disabled]);
  useEffect(() => {
    if (!url) return;
    void audio.current
      ?.play()
      .catch(() => setStatus('音频已生成，请点击播放器开始试听。'));
    return () => URL.revokeObjectURL(url);
  }, [url]);
  const preview = async () => {
    if (!serviceId || disabled || !active) return;
    stop();
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setStatus('正在连接并生成试听音频…');
    try {
      if (service?.type === 'browser') {
        setStatus('正在使用当前浏览器朗读…');
        await speakBrowserText(text, service, abort.signal);
        if (!abort.signal.aborted) setStatus('浏览器朗读完成。');
        return;
      }
      const blob = await consoleApi.previewVoice(serviceId, text, abort.signal);
      if (abort.signal.aborted) return;
      setUrl(URL.createObjectURL(blob));
      setStatus('连接成功，试听音频已生成。');
    } catch (error) {
      if (!abort.signal.aborted)
        setStatus(error instanceof Error ? error.message : '试听失败。');
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  return (
    <section className="voice-preview tts-preview" aria-label="语音试听">
      <div className="tts-preview-heading">
        <label htmlFor={textId}>试听文字</label>
        <select
          className="tts-preview-language"
          aria-label="试听示例语言"
          title="选择示例文字；不会更改已保存的音色"
          value={language}
          onChange={(event) => {
            const sample = voicePreviewSamples.find(
              (item) => item.language === event.target.value,
            );
            if (!sample) return;
            stop();
            setLanguage(sample.language);
            setText(sample.text);
          }}
        >
          {language === 'custom' && <option value="custom">自定义文字</option>}
          {voicePreviewSamples.map((sample) => (
            <option key={sample.language} value={sample.language}>
              {sample.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={
            !busy && (!serviceId || disabled || !active || !text.trim())
          }
          onClick={() => (busy ? stop() : void preview())}
          title={busy ? '取消当前试听' : '使用已保存的配置测试连接并试听'}
        >
          {busy ? '停止试听' : url ? '重新试听' : '试听'}
        </button>
      </div>
      <textarea
        id={textId}
        rows={2}
        maxLength={240}
        value={text}
        lang={language === 'custom' ? undefined : language}
        dir="auto"
        onChange={(e) => {
          stop();
          setText(e.target.value);
          setLanguage('custom');
        }}
      />
      <small className="tts-preview-hint">
        {service?.type === 'browser'
          ? '使用当前浏览器音色，请确认支持所选语言；远程音色可能联网。'
          : '使用已保存的音色，请确认支持所选语言；云端服务会接收文字并按服务商规则计费。'}
      </small>
      {status && (
        <p className="tts-preview-status" role="status">
          {status}
        </p>
      )}
      <audio
        ref={audio}
        controls
        hidden={!url}
        src={url || undefined}
        aria-label="试听音频"
        onError={() => setStatus('音频播放失败，请重试或检查浏览器音频设置。')}
      />
    </section>
  );
}

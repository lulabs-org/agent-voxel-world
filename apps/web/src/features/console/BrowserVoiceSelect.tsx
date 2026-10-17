import { useEffect, useState } from 'react';

export function BrowserVoiceSelect({
  value,
  language,
  onChange,
  active,
}: {
  value: string;
  language?: string;
  active: boolean;
  onChange: (voice: string, language: string) => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const supported = typeof window.speechSynthesis !== 'undefined';
  useEffect(() => {
    if (!active || !supported) return;
    const synth = window.speechSynthesis;
    const refresh = () => setVoices(synth.getVoices());
    refresh();
    synth.addEventListener('voiceschanged', refresh);
    return () => synth.removeEventListener('voiceschanged', refresh);
  }, [active, supported]);
  const key = (name: string, lang = '') => JSON.stringify([name, lang]);
  return (
    <>
      <div className="voice-select-field">
        <label>
          音色
          <select
            value={key(value, language)}
            disabled={!supported}
            onChange={(e) => {
              const [name, lang] = JSON.parse(e.target.value) as [
                string,
                string,
              ];
              onChange(name, lang);
            }}
          >
            <option value={key('')}>按中英文自动选择</option>
            {value &&
              !voices.some((v) => v.name === value && v.lang === language) && (
                <option value={key(value, language)}>
                  {value}（当前设备不可用，将按语言回退）
                </option>
              )}
            {voices.map((v, i) => (
              <option key={`${v.voiceURI}-${i}`} value={key(v.name, v.lang)}>
                {v.name} · {v.lang} · {v.localService ? '设备本地' : '远程音色'}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!supported}
          onClick={() => setVoices(window.speechSynthesis.getVoices())}
        >
          刷新音色列表
        </button>
      </div>
      {!supported && (
        <small role="alert">
          当前浏览器不支持语音合成，可选择其他语音服务。
        </small>
      )}
      {supported && !voices.length && (
        <small>浏览器尚未提供音色列表，可使用自动选择或刷新列表。</small>
      )}
    </>
  );
}

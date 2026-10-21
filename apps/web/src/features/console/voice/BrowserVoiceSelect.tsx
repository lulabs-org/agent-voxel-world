import { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n/context';

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
  const { t } = useI18n();
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
          {t('console.voice.voiceLabel')}
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
            <option value={key('')}>{t('console.voice.browserAutoVoice')}</option>
            {value &&
              !voices.some((v) => v.name === value && v.lang === language) && (
                <option value={key(value, language)}>
                  {t('console.voice.browserVoiceFallback', { name: value })}
                </option>
              )}
            {voices.map((v, i) => (
              <option key={`${v.voiceURI}-${i}`} value={key(v.name, v.lang)}>
                {v.name} · {v.lang} · {v.localService ? t('console.voice.deviceLocal') : t('console.voice.remoteVoice')}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!supported}
          onClick={() => setVoices(window.speechSynthesis.getVoices())}
        >
          {t('console.voice.browserRefreshVoices')}
        </button>
      </div>
      {!supported && (
        <small role="alert">
          {t('console.voice.browserNotSupported')}
        </small>
      )}
      {supported && !voices.length && (
        <small>{t('console.voice.browserNoVoices')}</small>
      )}
    </>
  );
}

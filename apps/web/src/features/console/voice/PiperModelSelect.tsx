import { PIPER_MODELS, type PiperModelView } from '@voxel/shared';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../i18n/context';
import { voiceApi } from './api';

export function PiperModelSelect({
  value,
  onChange,
  active,
}: {
  value: string;
  onChange: (value: string) => void;
  active: boolean;
}) {
  const { t } = useI18n();
  const [models, setModels] = useState<PiperModelView[]>([]);
  const [error, setError] = useState('');
  const [installing, setInstalling] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const installRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await voiceApi.listPiperModels(controller.signal);
        if (!controller.signal.aborted) {
          setModels(result);
          setError('');
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : t('console.characters.operationFailed'));
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void poll(), 3000);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, refresh, t]);
  useEffect(() => {
    if (!active) {
      installRequest.current?.abort();
      setInstalling(false);
    }
    return () => {
      installRequest.current?.abort();
    };
  }, [active]);
  const selected = models.find((model) => model.id === value);
  const install = async () => {
    installRequest.current?.abort();
    const controller = new AbortController();
    installRequest.current = controller;
    setInstalling(true);
    setError('');
    try {
      await voiceApi.installPiperModel(value, controller.signal);
      if (!controller.signal.aborted) setRefresh((n) => n + 1);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : t('console.characters.operationFailed'));
    } finally {
      if (!controller.signal.aborted) setInstalling(false);
    }
  };
  const states = {
    missing: t('console.voice.piperStatusMissing'),
    installing: t('console.voice.piperStatusInstalling'),
    installed: t('console.voice.piperStatusInstalled'),
    failed: t('console.voice.piperStatusFailed'),
  };
  return (
    <div>
      <label>
        {t('console.voice.voiceModel')}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {PIPER_MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
      <p role="status">{selected ? states[selected.state] : t('console.voice.piperChecking')}</p>
      {error && (
        <p className="agent-error" role="alert">
          {error}
        </p>
      )}
      {selected?.error && <p className="agent-error">{selected.error}</p>}
      <div className="voice-service-actions">
        <button
          type="button"
          disabled={
            !active ||
            installing ||
            !selected ||
            selected.state === 'installed' ||
            models.some((m) => m.state === 'installing')
          }
          onClick={() => void install()}
        >
          {selected?.state === 'failed' ? t('console.voice.piperRetryInstall') : t('console.voice.piperInstall')}
        </button>
        <button
          type="button"
          disabled={!active}
          onClick={() => setRefresh((n) => n + 1)}
        >
          {t('console.voice.piperRefresh')}
        </button>
      </div>
      <small>
        {t('console.voice.piperNotice')}
      </small>
    </div>
  );
}

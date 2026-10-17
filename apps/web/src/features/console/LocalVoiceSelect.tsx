import { useEffect, useState } from 'react';
import { consoleApi } from './api';

export function LocalVoiceSelect({
  value,
  onChange,
  active,
}: {
  value: string;
  onChange: (voice: string) => void;
  active: boolean;
}) {
  const [voices, setVoices] = useState<{ name: string; language: string }[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void consoleApi
      .listLocalVoices(controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setVoices(list);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '无法读取本机音色列表。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active, retry]);
  return (
    <>
      <div className="voice-select-field">
        <label>
          音色
          <select value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">按中英文自动选择</option>
            {value && !voices.some((voice) => voice.name === value) && (
              <option value={value}>{value}（当前配置，未在列表中找到）</option>
            )}
            {voices.map((voice) => (
              <option
                key={`${voice.name}-${voice.language}`}
                value={voice.name}
              >
                {voice.name} · {voice.language}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={loading}
          onClick={() => setRetry((count) => count + 1)}
        >
          {loading ? '加载音色中…' : '刷新音色列表'}
        </button>
      </div>
      {loading && <small role="status">正在读取服务器音色…</small>}
      {error && <small role="alert">{error}</small>}
      {!loading && !error && voices.length === 0 && (
        <small>服务器未返回可选音色。</small>
      )}
    </>
  );
}

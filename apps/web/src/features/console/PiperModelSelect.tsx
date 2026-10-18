import { useEffect, useRef, useState } from 'react';
import { PIPER_MODELS, type PiperModelView } from '@voxel/shared';
import { consoleApi } from './api';

export function PiperModelSelect({
  value,
  onChange,
  active,
}: {
  value: string;
  onChange: (value: string) => void;
  active: boolean;
}) {
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
        const result = await consoleApi.listPiperModels(controller.signal);
        if (!controller.signal.aborted) {
          setModels(result);
          setError('');
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '无法查询模型状态。');
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
  }, [active, refresh]);
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
      await consoleApi.installPiperModel(value, controller.signal);
      if (!controller.signal.aborted) setRefresh((n) => n + 1);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : '无法开始安装。');
    } finally {
      if (!controller.signal.aborted) setInstalling(false);
    }
  };
  const states = {
    missing: '未安装',
    installing: '安装中…',
    installed: '已安装',
    failed: '安装失败',
  };
  return (
    <div>
      <label>
        语音模型
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {PIPER_MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
      <p role="status">{selected ? states[selected.state] : '正在检查模型…'}</p>
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
          {selected?.state === 'failed' ? '重试安装' : '安装模型'}
        </button>
        <button
          type="button"
          disabled={!active}
          onClick={() => setRefresh((n) => n + 1)}
        >
          刷新状态
        </button>
      </div>
      <small>
        首次安装需要联网下载。模型保存在服务器，安装后可离线合成；关闭控制台后安装继续。
      </small>
    </div>
  );
}

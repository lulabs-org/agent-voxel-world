import { useEffect, useState } from 'react';
import type {
  VoiceServiceDraft,
  VoiceServiceType,
  VoiceServiceView,
} from '@voxel/shared';
import { consoleApi } from './api';
import { VoicePreview } from './VoicePreview';
import { BrowserVoiceSelect } from './BrowserVoiceSelect';
import { LocalVoiceSelect } from './LocalVoiceSelect';

const labels: Record<VoiceServiceType, string> = {
  local: 'macOS 系统语音',
  browser: '浏览器系统语音（Web Speech API）',
  bailian: '百炼语音合成',
  compatible: '兼容语音接口',
};
const fresh = (type: VoiceServiceType = 'local'): VoiceServiceDraft => ({
  name: '',
  type,
  apiKey: '',
  speed: 1,
  baseUrl:
    type === 'bailian'
      ? 'https://dashscope.aliyuncs.com/api/v1'
      : type === 'compatible'
        ? 'https://api.openai.com/v1'
        : '',
  model:
    type === 'bailian'
      ? 'qwen3-tts-flash'
      : type === 'compatible'
        ? 'tts-1'
        : '',
  voice: type === 'bailian' ? 'Cherry' : type === 'compatible' ? 'alloy' : '',
});
export function VoiceServices({
  services,
  onChange,
  active,
}: {
  services: VoiceServiceView[];
  onChange: (list: VoiceServiceView[]) => void;
  active: boolean;
}) {
  const [selected, setSelected] = useState<string | null | undefined>();
  const [draft, setDraft] = useState(fresh);
  const [dirty, setDirty] = useState(false);
  const [editingKey, setEditingKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const saved = services.find((s) => s.id === selected);
  const canKeepKey = (() => {
    if (!saved?.hasApiKey || saved.type !== draft.type) return false;
    try {
      return (
        new URL(draft.baseUrl.trim()).href.replace(/\/$/, '') === saved.baseUrl
      );
    } catch {
      return false;
    }
  })();
  const choose = (service?: VoiceServiceView) => {
    setSelected(service?.id ?? null);
    setEditingKey(false);
    setDraft(service ? { ...service, apiKey: '' } : fresh());
    setDirty(!service);
    setNotice('');
    setError('');
  };
  useEffect(() => {
    if (selected === undefined && services.length) choose(services[0]);
  }, [services, selected]);
  const change = (patch: Partial<VoiceServiceDraft>) => {
    setDraft({ ...draft, ...patch });
    setDirty(true);
    setNotice('');
    setError('');
  };
  const save = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await consoleApi.saveVoiceService(
        draft,
        selected ?? undefined,
      );
      onChange(
        selected
          ? services.map((s) => (s.id === selected ? value : s))
          : [...services, value],
      );
      choose(value);
      setNotice('已保存。可在这里试听，或在创建 Agent 时选择此服务。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败。');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await consoleApi.deleteVoiceService(selected);
      const next = services.filter((s) => s.id !== selected);
      onChange(next);
      choose(next[0]);
      setNotice('语音服务已删除。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="voice-services-layout">
      <aside className="agent-sidebar" aria-label="语音服务列表">
        <h3>语音服务</h3>
        <button disabled={busy} onClick={() => choose()}>
          ＋ 添加语音服务
        </button>
        {services.map((service) => (
          <button
            key={service.id}
            aria-pressed={selected === service.id}
            disabled={busy}
            onClick={() => choose(service)}
          >
            {service.name}
            <small>
              {labels[service.type]} · 语音合成
              <br />
              {service.voice || '自动选择音色'}
            </small>
          </button>
        ))}
        <p>同一服务商可保存多份音色配置，供不同 Agent 复用。</p>
      </aside>
      <div className="agent-form">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3>{selected ? '编辑语音服务' : '添加语音服务'}</h3>
          <p className="agent-hint">
            将 Agent 的文字回复合成为声音；回复内容仍由 Agent 的思考模型决定。
          </p>
          {error && (
            <p className="agent-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="agent-notice" role="status">
              {notice}
            </p>
          )}
          <fieldset disabled={busy}>
            <label>
              服务名称
              <input
                required
                maxLength={50}
                placeholder="请输入服务名称"
                value={draft.name}
                onChange={(e) => change({ name: e.target.value })}
              />
            </label>
            <label>
              服务类型
              <select
                value={draft.type}
                onChange={(e) => {
                  setDraft({
                    ...fresh(e.target.value as VoiceServiceType),
                    name: draft.name,
                  });
                  setDirty(true);
                }}
              >
                {Object.entries(labels).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {draft.type !== 'local' && draft.type !== 'browser' && (
              <>
                <label>
                  API Base URL
                  {draft.type === 'bailian' ? (
                    <select
                      value={draft.baseUrl}
                      onChange={(e) => change({ baseUrl: e.target.value })}
                    >
                      <option value="https://dashscope.aliyuncs.com/api/v1">
                        北京 · dashscope.aliyuncs.com
                      </option>
                      <option value="https://dashscope-intl.aliyuncs.com/api/v1">
                        新加坡 · dashscope-intl.aliyuncs.com
                      </option>
                    </select>
                  ) : (
                    <input
                      type="url"
                      required
                      value={draft.baseUrl}
                      onChange={(e) => change({ baseUrl: e.target.value })}
                    />
                  )}
                </label>
                <div className="voice-key-field">
                  <span className="voice-key-label">API Key</span>
                  {canKeepKey && !editingKey ? (
                    <div className="voice-key-saved">
                      <span role="status">密钥已配置</span>
                      <button type="button" onClick={() => setEditingKey(true)}>
                        更换密钥
                      </button>
                    </div>
                  ) : (
                    <div className="voice-key-input">
                      <input
                        aria-label="API Key"
                        type="password"
                        autoComplete="new-password"
                        value={draft.apiKey}
                        placeholder={
                          canKeepKey ? '输入新密钥，保存后生效' : '填写服务密钥'
                        }
                        onChange={(e) => change({ apiKey: e.target.value })}
                      />
                      {canKeepKey && (
                        <button
                          type="button"
                          onClick={() => {
                            if (draft.apiKey) change({ apiKey: '' });
                            setEditingKey(false);
                          }}
                        >
                          取消更换
                        </button>
                      )}
                    </div>
                  )}
                  <small>
                    {canKeepKey
                      ? editingKey
                        ? '留空保存仍使用已有密钥。'
                        : '密钥已保存在服务端，不回显到浏览器。'
                      : saved?.hasApiKey
                        ? '接口地址或服务类型已更改，请重新填写密钥。'
                        : '密钥仅保存在服务端。'}
                  </small>
                </div>
                <label>
                  语音模型
                  <input
                    required
                    maxLength={128}
                    value={draft.model}
                    onChange={(e) => change({ model: e.target.value })}
                  />
                </label>
              </>
            )}
            {draft.type === 'browser' ? (
              <BrowserVoiceSelect
                value={draft.voice}
                language={draft.voiceLanguage}
                onChange={(voice, voiceLanguage) =>
                  change({ voice, voiceLanguage })
                }
                active={active}
              />
            ) : draft.type === 'local' ? (
              <LocalVoiceSelect
                value={draft.voice}
                onChange={(voice) => change({ voice })}
                active={active}
              />
            ) : (
              <label>
                音色
                <input
                  required
                  maxLength={100}
                  value={draft.voice}
                  placeholder="服务支持的音色 ID"
                  onChange={(e) => change({ voice: e.target.value })}
                />
              </label>
            )}
            {draft.type !== 'bailian' && (
              <label>
                语速（0.5–2 倍）
                <input
                  type="number"
                  required
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={Number.isNaN(draft.speed) ? '' : draft.speed}
                  onChange={(e) => change({ speed: e.target.valueAsNumber })}
                />
              </label>
            )}
            {draft.type === 'browser' && (
              <p className="agent-hint">
                由接收者浏览器朗读，无需 API
                Key。音色因设备而异，缺失时按语言回退；远程音色可能联网。不支持左右声道空间定位。
              </p>
            )}
            {draft.type === 'local' && (
              <p className="agent-hint">
                使用服务器上的 macOS say 与
                ffmpeg，合成的声音发送给玩家，不从服务器扬声器播放。
              </p>
            )}
            {draft.type === 'bailian' && (
              <p className="agent-hint">
                支持 Qwen-TTS 与 Qwen-Audio-TTS，按模型自动选择合成接口。
                qwen3-tts-flash 可搭配 Cherry；qwen-audio-3.1-tts-flash 可搭配
                longanhuan_v3.1。音色须与模型及地域匹配。
              </p>
            )}
            <div className="voice-service-actions">
              <button className="primary" disabled={!dirty}>
                {busy ? '保存中…' : '保存服务'}
              </button>
              {selected && (
                <button type="button" onClick={() => void remove()}>
                  删除服务
                </button>
              )}
            </div>
          </fieldset>
        </form>
        {dirty && <p className="agent-hint">请先保存修改，再试听当前配置。</p>}
        <VoicePreview
          serviceId={selected ?? undefined}
          service={saved}
          active={active}
          disabled={dirty || busy}
        />
      </div>
    </div>
  );
}

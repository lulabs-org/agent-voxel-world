import type { BailianAsrDraft } from '@voxel/shared';
import type { AsrProvider } from './browser-asr-services';
import { browserLanguages } from './browser-asr-languages';
import type { useAsrServices } from './useAsrServices';

export function BailianAsrConfig({
  manager,
  disabled,
  models = ['default'],
}: {
  manager: ReturnType<typeof useAsrServices>;
  disabled: boolean;
  models?: string[];
}) {
  const {
    draft,
    selected: saved,
    dirty,
    saving: busy,
    change,
    save,
    remove,
    reload,
  } = manager;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        void save(
          submitter instanceof HTMLButtonElement &&
            submitter.value === 'add-another',
        );
      }}
    >
      <h3>{saved ? '编辑识别服务' : '添加识别服务'}</h3>
      <p className="agent-hint">
        每次添加都会创建独立服务，可分别保存浏览器识别的语言，或
        Whisper、阿里云的模型与参数。
      </p>
      <fieldset disabled={busy || disabled}>
        <label>
          服务名称
          <input
            required
            maxLength={50}
            value={draft.name}
            onChange={(e) => change({ name: e.target.value })}
          />
        </label>
        <label>
          服务类型
          <select
            value={draft.provider ?? 'bailian'}
            disabled={!!saved}
            onChange={(e) =>
              manager.changeProvider(e.target.value as AsrProvider)
            }
          >
            <option value="whisper">自托管 Whisper</option>
            <option value="bailian">阿里云百炼</option>
            <option value="browser">浏览器语音识别（Web Speech API）</option>
          </select>
        </label>
        {draft.provider === 'browser' ? (
          <>
            <label>
              主要识别语言
              <select
                value={draft.language}
                onChange={(e) => change({ language: e.target.value })}
              >
                {browserLanguages.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <small>
              配置仅保存在当前浏览器，不会同步到其他设备；无需 API
              Key。每次选择一种主要语言，实际支持取决于浏览器识别服务。
            </small>
          </>
        ) : draft.provider === 'whisper' ? (
          <>
            <label>
              识别模型
              <select
                value={draft.model}
                onChange={(e) => change({ model: e.target.value })}
              >
                {[...new Set([...models, draft.model])].map((model) => (
                  <option key={model} value={model}>
                    {model === 'default' ? '服务器默认模型' : model}
                  </option>
                ))}
              </select>
            </label>
            <small>模型须已安装在服务器；更换模型后保存并检查服务状态。</small>
            <label>
              线程数
              <input
                type="number"
                min={1}
                max={16}
                required
                value={draft.threads}
                onChange={(e) => change({ threads: e.target.valueAsNumber })}
              />
            </label>
            <label>
              搜索宽度（Beam size）
              <input
                type="number"
                min={1}
                max={8}
                required
                value={draft.beamSize}
                onChange={(e) => change({ beamSize: e.target.valueAsNumber })}
              />
            </label>
            <label>
              采样温度
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                required
                value={draft.temperature}
                onChange={(e) =>
                  change({ temperature: e.target.valueAsNumber })
                }
              />
            </label>
            <label>
              提示词（可选）
              <textarea
                maxLength={500}
                rows={2}
                value={draft.prompt}
                placeholder="例如：人名、专业术语或预期文字风格"
                onChange={(e) => change({ prompt: e.target.value })}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              服务地域
              <select
                value={draft.region}
                onChange={(e) =>
                  change({
                    region: e.target.value as BailianAsrDraft['region'],
                  })
                }
              >
                <option value="beijing">北京</option>
                <option value="singapore">新加坡</option>
              </select>
            </label>
            <label>
              业务空间 ID（可选）
              <input
                value={draft.workspaceId}
                maxLength={80}
                placeholder="留空使用公共接口"
                onChange={(e) => change({ workspaceId: e.target.value })}
              />
            </label>
            <label>
              识别模型
              <select
                value={draft.model}
                onChange={(e) =>
                  change({ model: e.target.value as BailianAsrDraft['model'] })
                }
              >
                <option value="fun-asr-realtime">Fun-ASR Realtime</option>
                <option value="paraformer-realtime-v2">
                  Paraformer Realtime v2
                </option>
              </select>
            </label>
            <label>
              API Key
              <input
                type="password"
                autoComplete="new-password"
                value={draft.apiKey}
                placeholder={
                  saved?.provider !== 'whisper' &&
                  saved?.provider !== 'browser' &&
                  saved?.hasApiKey
                    ? '已配置，留空保留'
                    : '填写百炼 API Key'
                }
                onChange={(e) => change({ apiKey: e.target.value })}
              />
            </label>
            <small>
              密钥仅保存于服务器。地域与业务空间须与密钥匹配，更换后需重新填写密钥。
            </small>
          </>
        )}
        <div className="voice-service-actions">
          <button type="submit" disabled={!dirty || manager.loading}>
            {busy ? '处理中…' : '保存识别服务'}
          </button>
          {!saved && manager.canAddAnother && (
            <button
              type="submit"
              value="add-another"
              disabled={!dirty || manager.loading}
            >
              保存并继续添加
            </button>
          )}
          {saved && (
            <button type="button" onClick={() => void remove()}>
              删除服务
            </button>
          )}
          <button type="button" onClick={reload}>
            重新加载
          </button>
        </div>
      </fieldset>
      {dirty && <p className="agent-hint">请先保存修改，再开始录音。</p>}
      {draft.provider === 'browser' ? (
        <p className="agent-hint">
          浏览器直接进行麦克风识别，可能使用在线识别服务。保存后可在下方试用；聊天和附近语音继续使用
          Whisper。
        </p>
      ) : draft.provider === 'whisper' ? (
        <p className="agent-hint">
          录音与文件使用当前 Whisper
          配置在项目服务器识别。聊天和附近语音继续使用服务器默认配置。
        </p>
      ) : (
        <>
          <p className="agent-hint">
            录音经项目服务器发送给阿里云，按服务商规则计费。此处选择用于 ASR
            试用；聊天和附近语音继续使用 Whisper。
          </p>
          <a
            href="https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide"
            target="_blank"
            rel="noreferrer"
          >
            阿里云接入文档 ↗
          </a>
        </>
      )}
    </form>
  );
}

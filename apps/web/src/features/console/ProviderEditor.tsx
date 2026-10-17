import type { AgentSettings, ProviderType, ProviderView } from '@voxel/shared';
import type { ConsoleController } from './useConsoleController';
import { freshProvider } from './model';

type Props = Pick<
  ConsoleController,
  | 'providers'
  | 'editing'
  | 'draft'
  | 'setDraft'
  | 'busy'
  | 'editingProvider'
  | 'editProvider'
  | 'saveProvider'
  | 'removeProvider'
  | 'models'
  | 'loadingModels'
  | 'readModels'
>;
export function ProviderEditor({
  providers,
  editing,
  draft,
  setDraft,
  busy,
  editingProvider,
  editProvider,
  saveProvider,
  removeProvider,
  models,
  loadingModels,
  readModels,
}: Props) {
  const savedConnection =
    editingProvider &&
    editingProvider.type === draft.type &&
    editingProvider.baseUrl === draft.baseUrl.trim() &&
    !draft.apiKey;
  const canReadModels =
    savedConnection &&
    (editingProvider.type === 'ollama' || editingProvider.hasApiKey);
  return (
    <div className="agent-columns">
      <aside className="agent-sidebar">
        <h3>模型服务</h3>
        {providers.map((p) => (
          <button
            key={p.id}
            aria-pressed={editing === p.id}
            onClick={() => editProvider(p)}
            disabled={busy}
          >
            {p.name}
            <small>
              {p.type === 'ollama'
                ? '本机 · 无需密钥'
                : p.hasApiKey
                  ? '密钥已配置'
                  : '尚未配置密钥'}{' '}
              · {p.defaultModel || '未设默认模型'}
            </small>
          </button>
        ))}
        <button onClick={() => editProvider()} disabled={busy}>
          ＋ 添加模型服务
        </button>
        <p>
          密钥仅保存在本机服务端，不会返回到浏览器。已有环境变量会在首次启动时导入。
        </p>
      </aside>
      <form onSubmit={saveProvider} className="agent-form">
        <h3>{editing ? '编辑模型服务' : '添加模型服务'}</h3>
        <fieldset disabled={busy || loadingModels}>
          <label>
            服务名称
            <input
              value={draft.name}
              required
              maxLength={50}
              placeholder="请输入服务名称"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            模型服务商
            <select
              value={draft.type}
              onChange={(e) =>
                setDraft({
                  ...freshProvider(e.target.value as ProviderType),
                  name: draft.name,
                })
              }
            >
              <option value="deepseek">DeepSeek</option>
              <option value="ollama">本机 Ollama</option>
              <option value="compatible">OpenAI 兼容服务</option>
            </select>
          </label>
          <label>
            API Base URL
            <input
              type="url"
              value={draft.baseUrl}
              required
              placeholder="https://api.example.com/v1"
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            />
          </label>
          {draft.type !== 'ollama' && (
            <label>
              API Key
              <input
                type="password"
                autoComplete="new-password"
                value={draft.apiKey}
                placeholder={
                  editingProvider?.hasApiKey
                    ? '已配置，留空保持现有密钥'
                    : '输入服务商 API Key'
                }
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              />
            </label>
          )}
          <label>
            默认模型 ID
            <input
              list={savedConnection ? 'provider-models' : undefined}
              value={draft.defaultModel}
              maxLength={128}
              placeholder="填写该服务支持的模型 ID"
              onChange={(e) =>
                setDraft({ ...draft, defaultModel: e.target.value })
              }
            />
            <datalist id="provider-models">
              {models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>
          <div className="agent-actions">
            <button
              type="button"
              disabled={!canReadModels}
              onClick={() => editing && void readModels(editing)}
            >
              {loadingModels ? '正在连接…' : '检测连接并获取模型'}
            </button>
          </div>
          {!canReadModels && (
            <p className="agent-hint">
              配置并保存服务连接后，即可检测连接并获取模型列表。
            </p>
          )}
          <section className="agents-form-section">
            <h4>推理设置</h4>
            <p className="agent-hint">
              使用此服务的角色共享这些参数，保存后从下一次模型调用起生效。
            </p>
            {editingProvider && !editingProvider.inference && (
              <p className="agent-hint">
                此服务尚未统一推理参数。保存后，以下参数将替代各角色原有的推理设置。
              </p>
            )}
            <div className="agent-grid">
              <label>
                请求超时（毫秒）
                <input
                  type="number"
                  min={1000}
                  max={120000}
                  step={1000}
                  required
                  value={draft.inference.timeoutMs}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      inference: {
                        ...draft.inference,
                        timeoutMs: e.target.valueAsNumber,
                      },
                    })
                  }
                />
              </label>
              <label>
                最大输出 tokens
                <input
                  type="number"
                  min={128}
                  max={16384}
                  required
                  value={draft.inference.maxTokens}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      inference: {
                        ...draft.inference,
                        maxTokens: e.target.valueAsNumber,
                      },
                    })
                  }
                />
              </label>
            </div>
            {draft.type === 'deepseek' && (
              <div className="agent-grid">
                <label>
                  思考模式
                  <select
                    value={draft.inference.thinking}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        inference: {
                          ...draft.inference,
                          thinking: e.target.value as AgentSettings['thinking'],
                          maxTokens: e.target.value === 'enabled' ? 4096 : 512,
                        },
                      })
                    }
                  >
                    <option value="disabled">关闭</option>
                    <option value="enabled">开启</option>
                  </select>
                </label>
                <label>
                  推理强度
                  <select
                    disabled={draft.inference.thinking !== 'enabled'}
                    value={draft.inference.reasoningEffort}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        inference: {
                          ...draft.inference,
                          reasoningEffort: e.target
                            .value as AgentSettings['reasoningEffort'],
                        },
                      })
                    }
                  >
                    {['none', 'low', 'high', 'max'].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <label className="agent-check">
              <input
                type="checkbox"
                checked={draft.jsonMode}
                onChange={(e) =>
                  setDraft({ ...draft, jsonMode: e.target.checked })
                }
              />
              请求 JSON 输出模式
            </label>
            {draft.type === 'compatible' && (
              <>
                <label>
                  输出上限字段
                  <select
                    aria-describedby="provider-token-field-hint"
                    value={draft.tokenField}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        tokenField: e.target
                          .value as ProviderView['tokenField'],
                      })
                    }
                  >
                    <option>max_tokens</option>
                    <option>max_completion_tokens</option>
                  </select>
                </label>
                <p id="provider-token-field-hint" className="agent-hint">
                  仅在接口报参数不支持时调整；输出上限数值在上方“最大输出
                  tokens”中设置。
                </p>
              </>
            )}
          </section>
          <p className="agent-hint">
            支持 OpenAI Chat Completions
            兼容接口。保存配置不会启动推理；新建或继续运行 Agent
            时使用最新配置。
          </p>
          <div className="agent-actions">
            <button className="primary">
              {busy ? '保存中…' : '保存模型服务'}
            </button>
            {editing && (
              <button type="button" onClick={() => void removeProvider()}>
                删除模型服务
              </button>
            )}
          </div>
        </fieldset>
      </form>
    </div>
  );
}

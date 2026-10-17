import { AgentAdvancedSettings } from './AgentAdvancedSettings';
import { AgentScheduleSettings } from './AgentScheduleSettings';
import type { ConsoleController } from './useConsoleController';
import { VoicePreview } from './VoicePreview';
import { agentPresentation } from './agent-presentation';

export function AgentForm(
  props: ConsoleController & { active: boolean; disabled: boolean },
) {
  const {
    providers,
    voiceServices,
    agent,
    setAgent,
    editingAgent,
    setShowAgentForm,
    busy,
    setNotice,
    setError,
    selected,
    chooseProvider,
    saveAgent,
    active,
    disabled,
    startTaskOnCreate,
    setStartTaskOnCreate,
    openModelServices,
    jobs,
    pauseAgent,
    toggleVoiceReplies,
  } = props;
  const current = jobs.find((job) => job.id === editingAgent);
  const running = current && !agentPresentation(current).canEdit;
  const cancel = () => {
    setShowAgentForm(false);
    setError('');
    setNotice('');
  };
  const validProvider =
    selected &&
    selected.defaultModel.trim() &&
    (selected.type === 'ollama' || selected.hasApiKey);
  return (
    <section className="agents-profile">
      <div className="agents-form-heading">
        <div>
          <h4>{editingAgent ? '角色设置' : '创建一位新伙伴'}</h4>
          <p>
            {editingAgent
              ? '昵称、模型与能力属于角色；任务在“任务”页单独安排。'
              : '先取个名字、选择已保存的模型服务，再决定它如何加入世界。'}
          </p>
        </div>
        {!editingAgent && (
          <button disabled={busy} onClick={cancel}>
            返回
          </button>
        )}
      </div>
      {running && (
        <div className="agents-confirm">
          <p>
            {agentPresentation(current).transitioning
              ? '角色正在加入或离开世界，请等待状态更新。'
              : '任务正在执行，请暂停后修改角色设置。'}
          </p>
          <button
            disabled={
              busy || !!props.pollError || !agentPresentation(current).canPause
            }
            onClick={() => void pauseAgent(current)}
          >
            暂停任务后编辑
          </button>
          {current.voiceServiceId &&
            !agentPresentation(current).transitioning && (
              <button
                disabled={busy || !!props.pollError}
                onClick={() => {
                  void toggleVoiceReplies(current);
                }}
              >
                {current.voiceReplies ? '关闭语音回复' : '开启语音回复'}
              </button>
            )}
        </div>
      )}
      <form
        className="agent-form"
        onSubmit={(event) => {
          event.preventDefault();
          void saveAgent();
        }}
      >
        <fieldset disabled={disabled}>
          <label>
            角色昵称
            <input
              autoFocus={!editingAgent}
              required
              maxLength={24}
              value={agent.name}
              placeholder="给伙伴取个名字"
              onChange={(event) =>
                setAgent({ ...agent, name: event.target.value })
              }
            />
          </label>
          <label>
            模型服务
            <select
              required
              value={agent.providerId}
              onChange={(event) => chooseProvider(event.target.value)}
            >
              <option value="" disabled>
                请选择模型服务
              </option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} · {provider.defaultModel || '未配置模型'}
                  {provider.type !== 'ollama' && !provider.hasApiKey
                    ? ' · 未配置密钥'
                    : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="agent-hint">
            直接使用所选服务中保存的模型与接口配置。如需更换模型，请在模型服务中修改或添加服务。
          </p>
          <div className="agents-model-actions">
            <button
              className="agents-text-button"
              type="button"
              onClick={openModelServices}
            >
              管理模型服务 ↗
            </button>
          </div>
          {!validProvider && (
            <p className="agent-hint">
              {!selected
                ? '请选择已保存的模型服务；没有可用服务时，请先添加。'
                : !selected.defaultModel.trim()
                  ? '此服务尚未配置模型，请先到模型服务中填写并保存模型 ID。'
                  : '此服务尚未配置密钥，请先到模型服务中配置。'}
            </p>
          )}
          <div className="agents-form-section">
            <h4>能力与交流</h4>
            <label className="agent-check agents-permission">
              <input
                type="checkbox"
                checked={agent.allowEdits}
                onChange={(event) =>
                  setAgent({ ...agent, allowEdits: event.target.checked })
                }
              />
              <span>
                允许建造
                <small>允许放置和移除方块；关闭时仍可移动、观察与交流。</small>
              </span>
            </label>
            <label>
              语音回复
              <select
                value={agent.voiceServiceId || ''}
                onChange={(event) =>
                  setAgent({
                    ...agent,
                    voiceServiceId: event.target.value,
                    voiceReplies: !!event.target.value,
                  })
                }
              >
                <option value="">仅文字回复</option>
                {voiceServices.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} · {service.voice || '自动音色'}
                  </option>
                ))}
              </select>
            </label>
            {agent.voiceServiceId && (
              <>
                <label className="agent-check">
                  <input
                    type="checkbox"
                    checked={!!agent.voiceReplies}
                    onChange={(event) =>
                      setAgent({ ...agent, voiceReplies: event.target.checked })
                    }
                  />
                  开启语音回复
                </label>
                <details className="agents-voice-preview">
                  <summary>试听已选音色</summary>
                  <VoicePreview
                    service={voiceServices.find(
                      (service) => service.id === agent.voiceServiceId,
                    )}
                    serviceId={agent.voiceServiceId}
                    active={active}
                    disabled={disabled}
                  />
                </details>
              </>
            )}
          </div>
          {!editingAgent && (
            <div className="agents-form-section">
              <h4>加入后做什么</h4>
              <div className="agents-start-options">
                <label className="agent-check">
                  <input
                    type="radio"
                    name="agent-start"
                    checked={!startTaskOnCreate}
                    onChange={() => setStartTaskOnCreate(false)}
                  />
                  <span>
                    先在世界中待命
                    <small>不主动执行任务，收到私聊或 @ 后回复。</small>
                  </span>
                </label>
                <label className="agent-check">
                  <input
                    type="radio"
                    name="agent-start"
                    checked={startTaskOnCreate}
                    onChange={() => setStartTaskOnCreate(true)}
                  />
                  <span>
                    立即执行任务<small>加入后开始使用所选模型完成目标。</small>
                  </span>
                </label>
              </div>
              {startTaskOnCreate && (
                <label>
                  第一个任务
                  <textarea
                    required
                    rows={3}
                    maxLength={2000}
                    value={agent.goal}
                    placeholder="例如：观察附近环境，并用中文介绍你的发现。"
                    onChange={(event) =>
                      setAgent({ ...agent, goal: event.target.value })
                    }
                  />
                </label>
              )}
            </div>
          )}
          <details className="agents-advanced">
            <summary>
              高级设置 <span>任务额度、执行节奏与推理</span>
            </summary>
            <AgentAdvancedSettings
              agent={agent}
              setAgent={setAgent}
              selected={selected}
            />
            <AgentScheduleSettings agent={agent} setAgent={setAgent} />
          </details>
          <p className="agent-hint">
            {editingAgent
              ? '保存设置不会启动任务。更换模型或建造权限会重置当前任务进度，需重新开始。'
              : '待命时不主动调用模型；执行任务和回复消息会产生模型用量。'}{' '}
            云端模型与语音按服务商规则计费。
          </p>
          <div className="agents-form-footer">
            <button type="button" onClick={cancel}>
              取消
            </button>
            <button
              className="primary"
              disabled={
                !validProvider ||
                !agent.name.trim() ||
                (!editingAgent && startTaskOnCreate && !agent.goal.trim())
              }
            >
              {busy
                ? '正在保存…'
                : editingAgent
                  ? '保存角色设置'
                  : startTaskOnCreate
                    ? '创建并开始任务'
                    : '创建并加入世界'}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

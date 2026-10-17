import { TaskBudgetFields } from './TaskBudgetFields';
import { AgentScheduleSettings } from './AgentScheduleSettings';
import type { ConsoleController } from './useConsoleController';
import { agentPresentation } from './agent-presentation';
import {
  AGENT_ROLE_DESCRIPTION_LIMIT,
  AGENT_PERMISSIONS,
  AGENT_SKILLS,
  agentPermissions,
} from '@voxel/shared';

export function AgentForm(props: ConsoleController & { disabled: boolean }) {
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
    disabled,
    startTaskOnCreate,
    setStartTaskOnCreate,
    jobs,
    pauseAgent,
    toggleVoiceReplies,
  } = props;
  const permissions = agentPermissions(agent);
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
          {!editingAgent && <h4>创建一位新伙伴</h4>}
          <p>
            {editingAgent
              ? '设定伙伴的身份、职责与能力；具体任务在“任务”页单独安排。'
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
            agentPermissions(current).chat &&
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
          <div className="agent-grid">
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
          </div>
          <p className="agent-hint">
            直接使用所选服务中保存的模型与接口配置。如需更换模型，请在模型服务中修改或添加服务。
          </p>
          {!validProvider && (
            <p className="agent-hint">
              {!selected
                ? '请选择已保存的模型服务；没有可用服务时，请先添加。'
                : !selected.defaultModel.trim()
                  ? '此服务尚未配置模型，请先到模型服务中填写并保存模型 ID。'
                  : '此服务尚未配置密钥，请先到模型服务中配置。'}
            </p>
          )}
          <label>
            角色设定（可选）
            <textarea
              rows={4}
              maxLength={AGENT_ROLE_DESCRIPTION_LIMIT}
              value={agent.roleDescription ?? ''}
              placeholder="例如：你是一名建筑师，负责规划和建造房屋。施工前先确认位置、尺寸和风格，遇到障碍先说明情况，用简洁的中文汇报进度。"
              aria-describedby="agent-role-hint"
              onChange={(event) =>
                setAgent({ ...agent, roleDescription: event.target.value })
              }
            />
          </label>
          <p className="agent-hint agents-role-meta" id="agent-role-hint">
            <span>
              用于后续对话和任务规划。任务需单独安排，执行操作需开启对应权限。
            </span>
            <span className="agents-role-count">
              {(agent.roleDescription ?? '').length} /{' '}
              {AGENT_ROLE_DESCRIPTION_LIMIT}
            </span>
          </p>
          <div className="agents-form-section">
            <h4>角色技能</h4>
            <p className="agent-hint">
              可组合选择，为任务规划提供专业指导。选择技能不会自动开启权限或开始任务。
            </p>
            <div className="agents-capability-grid">
              {AGENT_SKILLS.map((skill) => {
                const checked = agent.skills?.includes(skill.id) ?? false;
                const missing = skill.requires.filter((id) => !permissions[id]);
                return (
                  <label
                    key={skill.id}
                    className="agent-check agents-permission agents-capability-card"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        setAgent({
                          ...agent,
                          skills: event.target.checked
                            ? [...(agent.skills ?? []), skill.id]
                            : (agent.skills ?? []).filter(
                                (id) => id !== skill.id,
                              ),
                        })
                      }
                    />
                    <span>
                      {skill.name}
                      <small>{skill.description}</small>
                      <small>
                        所需权限：
                        {skill.requires
                          .map(
                            (id) =>
                              AGENT_PERMISSIONS.find((p) => p.id === id)!.name,
                          )
                          .join('、')}
                      </small>
                      {checked && missing.length > 0 && (
                        <small className="agents-capability-warning">
                          执行受限：未开启
                          {missing
                            .map(
                              (id) =>
                                AGENT_PERMISSIONS.find((p) => p.id === id)!
                                  .name,
                            )
                            .join('、')}
                          。技能仍可用于规划，不能执行未授权操作。
                        </small>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="agents-form-section">
            <h4>动作权限</h4>
            <p className="agent-hint">
              观察和等待始终可用。以下权限可独立开启或关闭。
            </p>
            <div className="agents-capability-grid">
              {AGENT_PERMISSIONS.map((permission) => (
                <label
                  key={permission.id}
                  className="agent-check agents-permission agents-capability-card"
                >
                  <input
                    type="checkbox"
                    checked={permissions[permission.id]}
                    onChange={(event) => {
                      const next = {
                        ...permissions,
                        [permission.id]: event.target.checked,
                      };
                      setAgent({
                        ...agent,
                        permissions: next,
                        allowEdits: next.place && next.remove,
                      });
                    }}
                  />
                  <span>
                    {permission.name}
                    <small>{permission.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="agents-form-section agents-voice-settings">
            <label className="agents-voice-toggle">
              <span>
                <strong>语音回复</strong>
                <small>使用已配置的 TTS 服务朗读角色回复</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label="开启语音回复"
                checked={!!agent.voiceReplies}
                disabled={!permissions.chat || voiceServices.length === 0}
                onChange={(event) =>
                  setAgent({
                    ...agent,
                    voiceReplies: event.target.checked,
                    voiceServiceId: event.target.checked
                      ? voiceServices.find(
                          (service) => service.id === agent.voiceServiceId,
                        )?.id ||
                        voiceServices[0]?.id ||
                        ''
                      : agent.voiceServiceId,
                  })
                }
              />
            </label>
            {!permissions.chat ? (
              <p className="agents-voice-status" role="status">
                发送聊天权限已关闭，不会发送文字或语音回复。重新开启聊天后，语音配置生效。
              </p>
            ) : voiceServices.length === 0 ? (
              <p className="agents-voice-status" role="status">
                暂无可用的音色服务，请先在「文本转语音（TTS）」中添加并保存服务。
              </p>
            ) : agent.voiceReplies ? (
              <label className="agents-voice-service">
                音色服务
                <select
                  value={agent.voiceServiceId || ''}
                  required
                  onChange={(event) =>
                    setAgent({ ...agent, voiceServiceId: event.target.value })
                  }
                >
                  {!voiceServices.some(
                    (service) => service.id === agent.voiceServiceId,
                  ) && (
                    <option value={agent.voiceServiceId || ''} disabled>
                      请选择可用的音色服务
                    </option>
                  )}
                  {voiceServices.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name} · {service.voice || '自动音色'}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="agents-voice-status">当前仅发送文字回复。</p>
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
                    <small>
                      {permissions.chat
                        ? '不主动执行任务，收到私聊或 @ 后回复。'
                        : '不主动执行任务。聊天权限已关闭，进展可在控制台查看。'}
                    </small>
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
          {!editingAgent && startTaskOnCreate && (
            <TaskBudgetFields
              value={agent}
              onChange={(limits) => setAgent({ ...agent, ...limits })}
            />
          )}
          <AgentScheduleSettings agent={agent} setAgent={setAgent} />
          <p className="agent-hint">
            {editingAgent
              ? '保存设置不会启动任务。更换模型会重置当前任务进度。修改技能或动作权限会暂停未结束任务，保留进度，需确认后继续。'
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

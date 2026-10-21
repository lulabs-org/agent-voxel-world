import { useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import {
  AI_CHARACTER_PERMISSIONS,
  AI_CHARACTER_ROLE_DESCRIPTION_LIMIT,
  AI_CHARACTER_SKILLS,
  aiCharacterPermissions,
} from '@voxel/shared';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  Cpu,
  Gauge,
  Info,
  Loader2,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  UserCog,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { TaskBudgetFields } from '../execution/TaskBudgetFields';
import type { ConsoleController } from '../useConsoleController';
import { DeleteAICharacterDialog } from './DeleteAICharacterDialog';
import { aiCharacterPresentation } from './presentation/agent-presentation';

export function AICharacterForm(
  props: ConsoleController & { disabled: boolean },
) {
  const {
    providers,
    voiceServices,
    agent,
    setAgent,
    editingAgent,
    setShowAgentForm,
    busy,
    notice,
    setNotice,
    setError,
    selected,
    chooseProvider,
    saveAgent,
    disabled,
    joinOnCreate,
    setJoinOnCreate,
    jobs,
    toggleVoiceReplies,
    deleteAgent,
    error,
  } = props;

  const [confirmDelete, setConfirmDelete] = useState(false);
  const permissions = aiCharacterPermissions(agent);
  const current = jobs.find((job) => job.id === editingAgent);
  const running = current && !aiCharacterPresentation(current).canEdit;

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
          <h4>
            {editingAgent ? (
              <UserCog size={18} className="agents-heading-icon" />
            ) : (
              <Bot size={18} className="agents-heading-icon" />
            )}
            {editingAgent ? '编辑 AI 角色设定' : '创建 AI 角色'}
          </h4>
          <p>
            {editingAgent
              ? '设定 AI 角色的身份、职责与能力；具体任务在“任务计划”页单独安排。'
              : '先取个名字、选择已保存的模型服务，再决定它如何加入世界。'}
          </p>
        </div>
        {!editingAgent && (
          <button
            type="button"
            disabled={busy}
            onClick={cancel}
            className="agents-btn-icon"
          >
            <ArrowLeft size={14} />
            返回
          </button>
        )}
      </div>

      {running && (
        <div className="agents-confirm agents-running-banner">
          <div className="agents-banner-text">
            <AlertCircle size={16} className="agents-banner-icon" />
            <p>
              {aiCharacterPresentation(current).transitioning
                ? 'AI 角色正在加入或离开世界，请等待状态更新。'
                : 'AI 角色正在执行，暂时不能修改设置。计划执行请在“任务计划”中处理；聊天执行可通过聊天暂停。'}
            </p>
          </div>
          {current.voiceServiceId &&
            aiCharacterPermissions(current).chat &&
            !aiCharacterPresentation(current).transitioning && (
              <button
                type="button"
                disabled={busy || !!props.pollError}
                onClick={() => {
                  void toggleVoiceReplies(current);
                }}
                className="agents-btn-icon"
              >
                {current.voiceReplies ? (
                  <>
                    <VolumeX size={14} />
                    关闭语音回复
                  </>
                ) : (
                  <>
                    <Volume2 size={14} />
                    开启语音回复
                  </>
                )}
              </button>
            )}
        </div>
      )}

      <form
        className="agent-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void saveAgent();
        }}
      >
        <fieldset disabled={disabled}>
          <div className="agent-grid">
            <label>
              <span className="agents-field-label">
                <User size={13} className="agents-field-icon" />
                AI 角色昵称
              </span>
              <input
                autoFocus={!editingAgent}
                required
                maxLength={24}
                value={agent.name}
                placeholder="给 AI 角色取个名字"
                onChange={(event) =>
                  setAgent({ ...agent, name: event.target.value })
                }
              />
            </label>
            <label>
              <span className="agents-field-label">
                <Cpu size={13} className="agents-field-icon" />
                模型服务
              </span>
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
            <Info size={12} className="agents-hint-icon" />
            直接使用所选服务中保存的模型与接口配置。如需更换模型，请在模型服务中修改或添加服务。
          </p>

          {!validProvider && (
            <div className="agents-form-alert warning">
              <AlertTriangle size={14} className="agents-alert-icon" />
              <span>
                {!selected
                  ? '请选择已保存的模型服务；没有可用服务时，请先添加。'
                  : !selected.defaultModel.trim()
                    ? '此服务尚未配置模型，请先到模型服务中填写并保存模型 ID。'
                    : '此服务尚未配置密钥，请先到模型服务中配置。'}
              </span>
            </div>
          )}

          <label className="agents-role-field">
            <span className="agents-field-label">
              <Sparkles size={13} className="agents-field-icon" />
              AI 角色设定（可选）
            </span>
            <textarea
              rows={4}
              maxLength={AI_CHARACTER_ROLE_DESCRIPTION_LIMIT}
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
              {AI_CHARACTER_ROLE_DESCRIPTION_LIMIT}
            </span>
          </p>

          <div className="agents-form-section">
            <h4>
              <Sparkles size={14} />
              AI 角色技能
            </h4>
            <p className="agent-hint">
              可组合选择，为任务规划提供专业指导。选择技能不会自动开启权限或开始任务。
            </p>
            <div className="agents-capability-grid">
              {AI_CHARACTER_SKILLS.map((skill) => {
                const checked = agent.skills?.includes(skill.id) ?? false;
                const missing = skill.requires.filter((id) => !permissions[id]);

                return (
                  <label
                    key={skill.id}
                    className={`agent-check agents-permission agents-capability-card${checked ? ' is-checked' : ''}`}
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
                    <span className="agents-capability-body">
                      <strong className="agents-capability-name">
                        {skill.name}
                      </strong>
                      <small className="agents-capability-desc">
                        {skill.description}
                      </small>
                      <small className="agents-capability-requires">
                        所需权限：
                        {skill.requires
                          .map(
                            (id) =>
                              AI_CHARACTER_PERMISSIONS.find((p) => p.id === id)!
                                .name,
                          )
                          .join('、')}
                      </small>
                      {checked && missing.length > 0 && (
                        <small className="agents-capability-warning">
                          <AlertTriangle
                            size={12}
                            className="agents-warning-icon"
                          />
                          执行受限：未开启
                          {missing
                            .map(
                              (id) =>
                                AI_CHARACTER_PERMISSIONS.find(
                                  (p) => p.id === id,
                                )!.name,
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
            <h4>
              <ShieldCheck size={14} />
              动作权限
            </h4>
            <p className="agent-hint">
              观察和等待始终可用。以下权限可独立开启或关闭。
            </p>
            <div className="agents-capability-grid">
              {AI_CHARACTER_PERMISSIONS.map((permission) => {
                const isChecked = !!permissions[permission.id];

                return (
                  <label
                    key={permission.id}
                    className={`agent-check agents-permission agents-capability-card${isChecked ? ' is-checked' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
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
                    <span className="agents-capability-body">
                      <strong className="agents-capability-name">
                        {permission.name}
                      </strong>
                      <small className="agents-capability-desc">
                        {permission.description}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="agents-form-section agents-voice-settings">
            <div className="agents-toggle-card">
              <div className="agents-toggle-info">
                <strong>
                  <Volume2 size={15} />
                  语音回复
                </strong>
                <small>使用已配置的 TTS 服务朗读 AI 角色回复</small>
              </div>
              <Switch.Root
                id="voice-reply-switch"
                className="agents-switch-root"
                aria-label="开启语音回复"
                checked={!!agent.voiceReplies}
                disabled={!permissions.chat || voiceServices.length === 0}
                onCheckedChange={(checked) =>
                  setAgent({
                    ...agent,
                    voiceReplies: checked,
                    voiceServiceId: checked
                      ? voiceServices.find(
                          (service) => service.id === agent.voiceServiceId,
                        )?.id ||
                        voiceServices[0]?.id ||
                        ''
                      : agent.voiceServiceId,
                  })
                }
              >
                <Switch.Thumb className="agents-switch-thumb" />
              </Switch.Root>
            </div>

            {!permissions.chat ? (
              <p className="agents-voice-status" role="status">
                发送聊天权限已关闭，不会发送文字或语音回复。重新开启聊天后，语音配置生效。
              </p>
            ) : voiceServices.length === 0 ? (
              <p className="agents-voice-status" role="status">
                暂无可用的音色服务，请先在「文本转语音（TTS）」中添加并保存服务。
              </p>
            ) : agent.voiceReplies ? (
              <div className="agents-voice-picker">
                <label className="agents-voice-service">
                  音色服务
                  <select
                    value={agent.voiceServiceId || ''}
                    required
                    onChange={(event) =>
                      setAgent({
                        ...agent,
                        voiceServiceId: event.target.value,
                      })
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
              </div>
            ) : (
              <p className="agents-voice-status">当前仅发送文字回复。</p>
            )}
          </div>

          <div className="agents-form-section agents-budget-settings">
            <div className="agents-toggle-card">
              <div className="agents-toggle-info">
                <strong>
                  <Gauge size={15} />
                  默认执行额度
                </strong>
                <small>
                  为任务设置调用上限、tokens 预算及执行时间；达到任一上限时暂停
                </small>
              </div>
              <Switch.Root
                id="task-limits-switch"
                className="agents-switch-root"
                aria-label="设置默认执行额度"
                checked={!!agent.taskLimitsEnabled}
                onCheckedChange={(checked) =>
                  setAgent({
                    ...agent,
                    taskLimitsEnabled: checked,
                  })
                }
              >
                <Switch.Thumb className="agents-switch-thumb" />
              </Switch.Root>
            </div>

            {agent.taskLimitsEnabled ? (
              <div className="agents-budget-content">
                <p className="agent-hint">
                  <Info size={12} className="agents-hint-icon" />
                  聊天发起的任务和继承设置的计划使用这些额度。修改只影响之后开始的执行。
                </p>
                <TaskBudgetFields
                  hideHeading
                  value={agent}
                  onChange={(limits) => setAgent({ ...agent, ...limits })}
                />
              </div>
            ) : (
              <p className="agents-budget-status">
                未启用默认执行额度，任务执行将不限制调用次数、tokens
                和执行时长。
              </p>
            )}
          </div>

          {!editingAgent && (
            <label className="agent-check agents-join-option">
              <input
                type="checkbox"
                checked={joinOnCreate}
                onChange={(e) => setJoinOnCreate(e.target.checked)}
              />
              <span>创建后让 AI 角色上线待命</span>
            </label>
          )}

          <p className="agent-hint agents-pricing-hint">
            <Info size={12} className="agents-hint-icon" />
            <span>
              {editingAgent
                ? '保存设置不会启动任务。更换模型会暂停未结束执行，保留进度和用量，需确认后继续。修改技能或动作权限会暂停未结束任务，保留进度，需确认后继续。'
                : '待命时不主动调用模型；执行任务和回复消息会产生模型用量。'}{' '}
              云端模型与语音按服务商规则计费。
            </span>
          </p>

          <div className="agents-form-footer">
            <div className="agents-footer-left">
              {editingAgent && current && (
                <button
                  type="button"
                  className="agents-delete-button agents-btn-icon"
                  disabled={disabled || current.status === 'stopping'}
                  onClick={() => {
                    setError('');
                    setConfirmDelete(true);
                  }}
                >
                  <Trash2 size={14} />
                  删除 AI 角色
                </button>
              )}
            </div>
            <div className="agents-footer-right">
              {notice && notice.includes('已保存') && (
                <span className="agents-footer-saved-hint" role="status">
                  <Check size={14} />
                  已保存
                </span>
              )}
              <button
                type="button"
                onClick={cancel}
                className="agents-btn-icon"
              >
                <ArrowLeft size={14} />
                取消
              </button>
              <button
                type="submit"
                className="primary agents-btn-icon"
                onClick={() => void saveAgent()}
                disabled={
                  !validProvider ||
                  !agent.name.trim() ||
                  (!editingAgent &&
                    joinOnCreate &&
                    props.jobs.filter(
                      (j) => aiCharacterPresentation(j).occupiesSlot,
                    ).length >= 4)
                }
              >
                {busy ? (
                  <>
                    <Loader2 size={14} className="agents-spin" />
                    正在保存…
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    {editingAgent
                      ? '保存 AI 角色设置'
                      : joinOnCreate
                        ? '创建 AI 角色并上线'
                        : '创建 AI 角色'}
                  </>
                )}
              </button>
            </div>
          </div>
        </fieldset>
      </form>

      {confirmDelete && current && (
        <DeleteAICharacterDialog
          name={current.name}
          busy={busy}
          disabled={disabled || current.status === 'stopping'}
          error={error}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void deleteAgent(current)}
        />
      )}
    </section>
  );
}

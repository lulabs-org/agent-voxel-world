import { agentPermissions, AGENT_PERMISSIONS } from '@voxel/shared';
import { useState } from 'react';
import type { ManagedAgentView } from '@voxel/shared';
import type { ConsoleController } from './useConsoleController';
import { agentPresentation } from './agent-presentation';

export function AgentTaskPanel(
  props: ConsoleController & {
    job: ManagedAgentView;
    disabled: boolean;
    capacityFull: boolean;
  },
) {
  const {
    job,
    disabled,
    capacityFull,
    taskEditor,
    setTaskEditor,
    taskGoal,
    setTaskGoal,
    assignTask,
    resumeAgent,
    pauseAgent,
    cancelTask,
  } = props;
  const [confirmation, setConfirmation] = useState<'resume' | 'cancel'>();
  const state = agentPresentation(job);
  const task = job.task;
  const editing = taskEditor === job.id;
  const cannotStart =
    disabled || state.transitioning || (!state.occupiesSlot && capacityFull);
  const compose = (prefill = '') => {
    setTaskGoal(prefill);
    setTaskEditor(job.id);
    setConfirmation(undefined);
  };
  const needsRevision =
    job.taskRequiresReassignment ||
    ['needs_input', 'blocked'].includes(task?.status ?? '');
  return (
    <section className="agents-task-panel" aria-label="任务管理">
      {task ? (
        <>
          <div className="agents-task-heading">
            <span className="agents-section-label">
              {state.ended ? '上一次任务' : '当前任务'}
            </span>
            <span
              className="agents-task-status"
              data-attention={state.attention}
              data-complete={task.status === 'completed'}
            >
              {state.taskLabel}
            </span>
          </div>
          <h4 className="agents-goal">{task.goal}</h4>
          <div className="agents-progress">
            <span className="agents-section-label">最近进展</span>
            <p>{task.summary || '任务尚未开始执行。'}</p>
            {task.reason && task.reason !== task.summary && (
              <p className="agents-reason" data-attention={state.attention}>
                {task.reason}
              </p>
            )}
          </div>
          {!editing && (
            <div className="agents-actions">
              {state.canPause && (
                <button
                  className="primary"
                  disabled={disabled}
                  onClick={() => void pauseAgent(job)}
                >
                  暂停任务
                </button>
              )}
              {needsRevision && !state.executing && (
                <button
                  className="primary"
                  disabled={cannotStart}
                  onClick={() => compose(`${task.goal}\n\n补充说明：`)}
                >
                  补充或调整任务
                </button>
              )}
              {state.canResume && !needsRevision && (
                <button
                  className={state.ended ? '' : 'primary'}
                  disabled={cannotStart}
                  onClick={() => {
                    if (state.ended || task.status === 'budget')
                      setConfirmation('resume');
                    else void resumeAgent(job);
                  }}
                >
                  {state.online
                    ? state.resumeLabel
                    : `加入并${state.resumeLabel}`}
                </button>
              )}
              <button
                className={state.ended ? 'primary' : ''}
                disabled={cannotStart}
                onClick={() => compose()}
              >
                安排新任务
              </button>
              {state.canCancel && (
                <button
                  className="agents-text-button"
                  disabled={disabled}
                  onClick={() => setConfirmation('cancel')}
                >
                  取消任务
                </button>
              )}
            </div>
          )}
          {confirmation && (
            <div
              className="agents-confirm"
              role="group"
              aria-label="确认任务操作"
            >
              <p>
                {confirmation === 'cancel'
                  ? '取消后不再执行此任务，已完成的世界改动保留。'
                  : task.status === 'budget'
                    ? `继续后开启新额度：最多 ${job.maxTurns} 次模型调用、${(job.tokenBudget ?? 50000).toLocaleString()} tokens、${(job.taskTimeoutMs ?? 900000) / 60000} 分钟。云端模型按服务商规则计费。`
                    : '将从头执行同一任务，可能重复移动、发言或建造，并产生新的模型用量。'}
              </p>
              <div className="agents-actions">
                <button
                  className="primary"
                  disabled={confirmation === 'resume' ? cannotStart : disabled}
                  onClick={() => {
                    setConfirmation(undefined);
                    void (confirmation === 'cancel'
                      ? cancelTask(job)
                      : resumeAgent(job));
                  }}
                >
                  {confirmation === 'cancel'
                    ? '确认取消任务'
                    : task.status === 'budget'
                      ? '确认追加并继续'
                      : '确认重新执行'}
                </button>
                <button onClick={() => setConfirmation(undefined)}>返回</button>
              </div>
            </div>
          )}
        </>
      ) : (
        !editing && (
          <div className="agents-task-empty">
            <span className="agents-section-label">任务</span>
            <h4>接下来，一起做点什么？</h4>
            <p>
              让它观察附近环境，或在开启放置方块权限后协助搭建。
              <br />
              {agentPermissions(job).chat
                ? '也可以先在世界中聊聊。'
                : '发送聊天已关闭，进展会显示在控制台。'}
            </p>
            <button
              className="primary"
              disabled={cannotStart}
              onClick={() => compose()}
            >
              安排第一个任务
            </button>
          </div>
        )
      )}
      {editing && (
        <form
          className="agents-composer agent-form"
          onSubmit={(event) => {
            event.preventDefault();
            void assignTask(job);
          }}
        >
          <label>
            任务说明
            <textarea
              autoFocus
              required
              rows={4}
              maxLength={2000}
              value={taskGoal}
              onChange={(event) => setTaskGoal(event.target.value)}
              placeholder="例如：观察附近的建筑，用中文介绍你的发现。"
            />
          </label>
          <p className="agent-hint">
            {task && !state.ended ? '开始后会替换当前任务。' : ''}
            {state.online
              ? '角色将在当前位置开始。'
              : '角色将加入世界并开始执行。'}
            {'已开启权限：' +
              (AGENT_PERMISSIONS.filter(({ id }) => agentPermissions(job)[id])
                .map(({ name }) => name)
                .join('、') || '仅基础观察与等待') +
              '。'}
          </p>
          <div className="agents-actions">
            <button
              className="primary"
              disabled={cannotStart || !taskGoal.trim()}
            >
              {busyLabel(props.busy, state.online)}
            </button>
            <button
              type="button"
              disabled={props.busy}
              onClick={() => setTaskEditor(undefined)}
            >
              取消编辑
            </button>
          </div>
        </form>
      )}
      {!state.occupiesSlot && capacityFull && (
        <p className="agent-hint">在线名额已满，请先让其他角色离开世界。</p>
      )}
      {task && (
        <div className="agents-budget">
          <div>
            <span className="agents-section-label">本轮任务额度</span>
            <strong>
              {task.calls} <small>/ {job.maxTurns} 次调用</small>
            </strong>
          </div>
          <progress
            value={Math.min(task.calls, job.maxTurns)}
            max={job.maxTurns}
            aria-label="任务调用额度"
          />
          <p>
            {task.estimated ? '约 ' : ''}
            {task.tokens.toLocaleString()} tokens · 执行{' '}
            {Math.floor(task.elapsedMs / 60000)} 分{' '}
            {Math.floor(task.elapsedMs / 1000) % 60} 秒
          </p>
        </div>
      )}
    </section>
  );
}
function busyLabel(busy: boolean, online: boolean) {
  return busy ? '正在处理…' : online ? '开始任务' : '加入并开始任务';
}

import { agentPermissions, AGENT_PERMISSIONS } from '@voxel/shared';
import { useState } from 'react';
import {
  TaskBudgetFields,
  taskBudgetOf,
  type TaskBudget,
} from './TaskBudgetFields';
import type { ManagedAgentView } from '@voxel/shared';
import type { ConsoleController } from './useConsoleController';
import { agentPresentation } from './agent-presentation';
import { AgentTaskResources } from './AgentTaskResources';
import { taskPresentation } from './task-presentation';

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
  const [composeMode, setComposeMode] = useState<'new' | 'revise'>('new');
  const [confirmation, setConfirmation] = useState<'resume' | 'cancel'>();
  const [limits, setLimits] = useState<TaskBudget>(() => taskBudgetOf(job));
  const state = agentPresentation(job);
  const task = job.task;
  const presentation = taskPresentation(job);
  const editing = taskEditor === job.id;
  const cannotStart =
    disabled || state.transitioning || (!state.occupiesSlot && capacityFull);
  const compose = (mode: 'new' | 'revise' = 'new') => {
    setComposeMode(mode);
    setLimits(taskBudgetOf(job));
    setTaskGoal(mode === 'revise' ? (task?.goal ?? '') : '');
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
              {state.ended ? '上一次任务目标' : '任务目标'}
            </span>
            <button
              className="agents-new-task"
              disabled={cannotStart}
              onClick={() => compose()}
            >
              ＋ 新建任务
            </button>
          </div>
          <h4 className="agents-goal">{task.goal}</h4>
          <section
            className="agents-task-state"
            data-attention={presentation!.attention}
            aria-label="当前状态"
          >
            <span className="agents-section-label">当前状态</span>
            <h4>{presentation!.status}</h4>
            <p>
              <span>{presentation!.reasonLabel}：</span>
              {presentation!.reason}
            </p>
            {job.taskRequiresReassignment && (
              <p>原私聊会话已失效，请修改任务后重新开始。</p>
            )}
          </section>
          <section className="agents-task-result" aria-label="执行结果">
            <div className="agents-task-heading">
              <h4>执行结果</h4>
              <span className="agents-section-label">Agent 最近汇报</span>
            </div>
            <p>{task.summary || '尚无执行汇报。'}</p>
            <small>
              汇报可能包含后续计划，不代表动作已完成；实际执行情况可在“运行记录”中查看。
            </small>
          </section>
          {!editing && !confirmation && (
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
              {state.canResume && !needsRevision && (
                <button
                  className={state.ended ? '' : 'primary'}
                  disabled={cannotStart}
                  onClick={() => {
                    if (state.ended || task.status === 'budget') {
                      setLimits(taskBudgetOf(job));
                      setConfirmation('resume');
                    } else void resumeAgent(job);
                  }}
                >
                  {state.online
                    ? state.resumeLabel
                    : `加入并${state.resumeLabel}`}
                </button>
              )}
              {!state.ended && (
                <button
                  className={needsRevision ? 'primary' : ''}
                  disabled={cannotStart}
                  onClick={() => compose('revise')}
                >
                  {needsRevision ? '补充任务说明' : '修改任务'}
                </button>
              )}
              {state.canCancel && (
                <button
                  className="agents-text-button"
                  disabled={disabled}
                  onClick={() => setConfirmation('cancel')}
                >
                  结束任务
                </button>
              )}
            </div>
          )}
          {confirmation && (
            <form
              className="agents-confirm agent-form"
              onSubmit={(event) => {
                event.preventDefault();
                setConfirmation(undefined);
                void (confirmation === 'cancel'
                  ? cancelTask(job)
                  : resumeAgent(job, limits));
              }}
              role="group"
              aria-label="确认任务操作"
            >
              <p>
                {confirmation === 'cancel'
                  ? '结束后不再执行此任务，已发生的世界改动和运行记录保留。'
                  : task.status === 'budget'
                    ? `保留目标与已有进展，继续执行。下一额度周期最多 ${limits.maxTurns} 次模型调用、${(limits.tokenBudget ?? 50000).toLocaleString()} tokens、${(limits.taskTimeoutMs ?? 900000) / 60000} 分钟。云端模型按服务商规则计费。`
                    : '将从头执行同一任务，可能重复移动、发言或建造，并产生新的模型用量。'}
              </p>
              {confirmation === 'resume' && (
                <TaskBudgetFields value={limits} onChange={setLimits} />
              )}
              <div className="agents-actions">
                <button
                  className="primary"
                  disabled={confirmation === 'resume' ? cannotStart : disabled}
                >
                  {confirmation === 'cancel'
                    ? '确认结束任务'
                    : task.status === 'budget'
                      ? '确认额度并继续'
                      : '确认重新执行'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmation(undefined)}
                >
                  返回
                </button>
              </div>
            </form>
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
            void assignTask(job, limits);
          }}
        >
          <h4>{composeMode === 'revise' ? '修改任务' : '新建任务'}</h4>
          <label>
            任务目标与完成条件
            <textarea
              autoFocus
              required
              rows={4}
              maxLength={2000}
              value={taskGoal}
              onChange={(event) => setTaskGoal(event.target.value)}
              placeholder="例如：探索营地附近的三处建筑，汇报各自的位置和特点，汇报完毕后结束任务。"
              aria-describedby="agent-task-goal-hint"
            />
          </label>
          <p className="agent-hint" id="agent-task-goal-hint">
            说明范围、预期结果和结束条件，避免任务无限持续。
          </p>
          <p className="agent-hint">
            {composeMode === 'revise'
              ? '修改后将从头规划，当前任务进度和本轮额度重新计数，已发生的世界改动保留。'
              : ''}
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
          <TaskBudgetFields value={limits} onChange={setLimits} />
          <div className="agents-actions">
            <button
              className="primary"
              disabled={cannotStart || !taskGoal.trim()}
            >
              {props.busy
                ? '正在处理…'
                : composeMode === 'revise'
                  ? '应用修改并重新开始'
                  : state.online
                    ? '开始任务'
                    : '加入并开始任务'}
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
      {task && <AgentTaskResources job={job} />}
    </section>
  );
}

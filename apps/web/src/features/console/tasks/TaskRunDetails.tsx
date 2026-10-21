import type { TaskLimits, TaskRun } from '@voxel/shared';
import { useState } from 'react';
import { TaskActionList } from './TaskActionList';
import { TaskBudgetFields } from '../execution/TaskBudgetFields';
import {
  planTime,
  runEnded,
  runStatus,
} from './presentation/task-plan-presentation';
export function TaskRunDetails({
  run,
  planGoal,
  hideHeading = false,
  busy,
  blocked,
  onAction,
}: {
  run: TaskRun;
  planGoal: string;
  hideHeading?: boolean;
  busy: boolean;
  blocked: string;
  onAction: (
    run: TaskRun,
    op: 'pause' | 'resume' | 'cancel',
    limits?: TaskLimits,
  ) => Promise<void>;
}) {
  const [resume, setResume] = useState(false),
    [cancel, setCancel] = useState(false);
  const [limits, setLimits] = useState(run.snapshot.limits);
  const limited = run.snapshot.limits.enabled !== false;
  const queued = run.status === 'queued';
  const inheritedPending =
    !run.startedAt && run.snapshot.limitsMode === 'inherit';
  const active = ['running', 'waiting'].includes(run.status);
  return (
    <section className="plans-run-card task-run-detail" aria-label="执行详情">
      {!hideHeading && (
        <div className="plans-run-header task-run-heading">
          <span
            className="plans-run-status-badge"
            data-active={['running', 'waiting'].includes(run.status)}
            data-warn={['paused', 'budget', 'needs_input', 'blocked'].includes(
              run.status,
            )}
            data-error={['failed', 'missed'].includes(run.status)}
          >
            <span
              className="plans-presence-dot"
              data-state={
                ['running', 'waiting'].includes(run.status)
                  ? 'enabled'
                  : ['paused', 'budget', 'needs_input'].includes(run.status)
                    ? 'paused'
                    : 'completed'
              }
            />
            {runStatus[run.status] || run.status}
          </span>
          <span className="plans-run-time">
            {planTime(run.startedAt ?? run.scheduledAt, run.snapshot.timeZone)}{' '}
            · {run.snapshot.timeZone}
          </span>
        </div>
      )}
      <p className="plans-run-meta-line agent-hint">
        执行角色：{run.characterName ?? '历史角色'} · 计划修订{' '}
        {run.planRevision ?? 1} ·{' '}
        {run.source === 'scheduled'
          ? '时间触发'
          : run.source === 'legacy'
            ? '历史导入'
            : '手动执行'}
      </p>
      {run.snapshot.goal.trim() !== planGoal.trim() && (
        <div className="plans-run-goal-box task-run-goal">
          <strong>本次目标：</strong>
          {run.snapshot.goal}
        </div>
      )}
      {run.reason && run.reason !== run.task?.summary && (
        <p className="task-run-reason" role="status">
          {run.reason}
        </p>
      )}
      {run.requiresReassignment && (
        <p className="agent-error" role="alert">
          原私聊会话已失效，不能继续此执行。请结束本次执行后重新安排。
        </p>
      )}
      <div className="plans-run-report-box task-report">
        <span
          className="plans-run-report-label agents-section-label"
          title="汇报可能含计划；已执行动作请查看实际动作记录。"
        >
          AI 角色汇报
        </span>
        <p>{run.task?.summary || '尚无汇报'}</p>
      </div>
      <dl className="plans-run-stats task-run-usage">
        <div className="plans-run-stat">
          <dt>模型调用轮次</dt>
          <dd>
            {run.task?.calls ?? 0} /{' '}
            {inheritedPending
              ? '启动时确定'
              : limited
                ? run.snapshot.limits.maxTurns
                : '不限'}
          </dd>
        </div>
        <div className="plans-run-stat">
          <dt>tokens{run.task?.estimated ? '（估算）' : ''}</dt>
          <dd>
            {run.totalTokens.toLocaleString()} /{' '}
            {inheritedPending
              ? '启动时确定'
              : limited
                ? run.snapshot.limits.tokenBudget.toLocaleString()
                : '不限'}
          </dd>
        </div>
        <div className="plans-run-stat">
          <dt>有效执行时间</dt>
          <dd>
            {Math.round((run.task?.elapsedMs ?? 0) / 1000)} 秒 /{' '}
            {inheritedPending
              ? '启动时确定'
              : limited
                ? `${run.snapshot.limits.taskTimeoutMs / 60000} 分钟`
                : '不限'}
          </dd>
        </div>
      </dl>
      {queued && (
        <p className="agent-hint">
          等待当前活动结束；已合并 {run.coalescedTriggers ?? 0}{' '}
          次重复触发，尚未消耗额度。
        </p>
      )}
      <TaskActionList actions={run.actions} />
      {!runEnded(run) && (
        <div className="agents-actions task-detail-actions">
          {active ? (
            <button disabled={busy} onClick={() => void onAction(run, 'pause')}>
              暂停本次执行
            </button>
          ) : !queued ? (
            <button
              className="primary"
              disabled={busy || !!blocked || run.requiresReassignment}
              onClick={() => {
                setResume(true);
                setCancel(false);
                setLimits(run.snapshot.limits);
              }}
            >
              继续本次执行
            </button>
          ) : null}
          <button
            disabled={busy}
            onClick={() => {
              setCancel(true);
              setResume(false);
            }}
          >
            {queued ? '取消待执行项' : '结束本次执行'}
          </button>
        </div>
      )}
      {!active && !runEnded(run) && blocked && (
        <p className="agent-hint">{blocked}，暂时不能继续。</p>
      )}
      {resume && (
        <form
          className="agent-form agents-confirm"
          onSubmit={(e) => {
            void (async () => {
              e.preventDefault();
              await onAction(run, 'resume', limits);
              setResume(false);
            })();
          }}
        >
          <p>
            保留已有进度与用量；继续本次执行不会恢复计划。启用限制时，总额度须高于已用量。
          </p>
          {limited ? (
            <TaskBudgetFields
              value={limits}
              onChange={(v) => setLimits({ ...limits, ...v })}
            />
          ) : (
            <p className="agent-hint">
              本次执行不设额度限制，继续后仍记录实际用量。
            </p>
          )}
          <div className="agents-actions task-detail-actions">
            <button className="primary" disabled={busy || !!blocked}>
              确认并继续
            </button>
            <button type="button" onClick={() => setResume(false)}>
              取消
            </button>
          </div>
        </form>
      )}
      {cancel && (
        <div className="agents-confirm">
          <p>结束后无法继续本次进度。已发生的动作和历史记录保留。</p>
          <div className="agents-actions task-detail-actions">
            <button
              disabled={busy}
              onClick={() => {
                void (async () => {
                  await onAction(run, 'cancel');
                  setCancel(false);
                })();
              }}
            >
              确认结束
            </button>
            <button onClick={() => setCancel(false)}>返回</button>
          </div>
        </div>
      )}
    </section>
  );
}

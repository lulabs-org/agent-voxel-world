import type { TaskLimits, TaskRun } from '@voxel/shared';
import { useState } from 'react';
import { TaskActionList } from './TaskActionList';
import { TaskBudgetFields } from './TaskBudgetFields';
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
  const active = ['running', 'waiting'].includes(run.status);
  return (
    <section className="task-run-detail" aria-label="执行详情">
      {!hideHeading && (
        <div className="agents-task-heading task-run-heading">
          <strong>{runStatus[run.status]}</strong>
          <small>
            {planTime(run.startedAt ?? run.scheduledAt, run.snapshot.timeZone)}{' '}
            · {run.snapshot.timeZone}
          </small>
        </div>
      )}
      {run.snapshot.goal.trim() !== planGoal.trim() && (
        <p className="task-run-goal">
          <span className="agents-section-label">本次目标 · </span>
          {run.snapshot.goal}
        </p>
      )}
      {run.reason && run.reason !== run.task?.summary && (
        <p className="task-run-reason" role="status">
          {run.reason}
        </p>
      )}
      {run.requiresReassignment && (
        <p className="agent-error">
          原私聊会话已失效，不能继续此执行。请结束本次执行后重新安排。
        </p>
      )}
      <div className="task-report">
        <span
          className="agents-section-label"
          title="汇报可能含计划；已执行动作请查看实际动作记录。"
        >
          Agent 汇报
        </span>
        <p>{run.task?.summary || '尚无汇报'}</p>
      </div>
      <dl className="task-run-usage">
        <div>
          <dt>模型调用</dt>
          <dd>
            {run.task?.calls ?? 0} /{' '}
            {limited ? run.snapshot.limits.maxTurns : '不限'}
          </dd>
        </div>
        <div>
          <dt>tokens{run.task?.estimated ? '（估算）' : ''}</dt>
          <dd>
            {run.totalTokens.toLocaleString()} /{' '}
            {limited
              ? run.snapshot.limits.tokenBudget.toLocaleString()
              : '不限'}
          </dd>
        </div>
        <div>
          <dt>有效执行时间</dt>
          <dd>
            {Math.round((run.task?.elapsedMs ?? 0) / 1000)} 秒 /{' '}
            {limited
              ? `${run.snapshot.limits.taskTimeoutMs / 60000} 分钟`
              : '不限'}
          </dd>
        </div>
      </dl>
      <TaskActionList actions={run.actions} />
      {!runEnded(run) && (
        <div className="agents-actions task-detail-actions">
          {active ? (
            <button disabled={busy} onClick={() => void onAction(run, 'pause')}>
              暂停本次执行
            </button>
          ) : (
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
          )}
          <button
            disabled={busy}
            onClick={() => {
              setCancel(true);
              setResume(false);
            }}
          >
            结束本次执行
          </button>
        </div>
      )}
      {!active && !runEnded(run) && blocked && (
        <p className="agent-hint">{blocked}，暂时不能继续。</p>
      )}
      {resume && (
        <form
          className="agent-form agents-confirm"
          onSubmit={async (e) => {
            e.preventDefault();
            await onAction(run, 'resume', limits);
            setResume(false);
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
              onClick={async () => {
                await onAction(run, 'cancel');
                setCancel(false);
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

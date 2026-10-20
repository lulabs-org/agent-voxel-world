import type { AICharacterView, TaskLimits } from '@voxel/shared';
import { useState } from 'react';
import { displayedTaskIdentity, tasksApi } from '../tasks/api';
import { TaskBudgetFields } from '../tasks/TaskBudgetFields';

export function CurrentTaskBudget({
  job,
  disabled,
  onUpdated,
}: {
  job: AICharacterView;
  disabled: boolean;
  onUpdated: () => Promise<void>;
}) {
  const execution = job.taskExecution;
  const task = job.task;
  const [draft, setDraft] = useState<{
    limits: TaskLimits;
    expectedTask: ReturnType<typeof displayedTaskIdentity>;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!execution || !task) return null;
  const limited = execution.limits.enabled !== false;
  const resumable = [
    'budget',
    'paused',
    'needs_input',
    'blocked',
    'failed',
  ].includes(task.status);
  const offline =
    !job.sessionId ||
    ['stopped', 'stopping', 'joining', 'failed'].includes(job.status);
  const blocked = disabled || busy || offline || !!job.taskRequiresReassignment;
  return (
    <section className="agents-progress" aria-label="当前任务预算">
      <h4>当前任务：{task.goal}</h4>
      {task.reason && <p role="status">{task.reason}</p>}
      <dl className="plans-run-stats task-run-usage">
        <div>
          <dt>模型调用</dt>
          <dd>
            {task.calls} / {limited ? execution.limits.maxTurns : '不限'} 次
          </dd>
        </div>
        <div>
          <dt>tokens{task.estimated ? '（估算）' : ''}</dt>
          <dd>
            {task.tokens.toLocaleString()} /{' '}
            {limited ? execution.limits.tokenBudget.toLocaleString() : '不限'}
          </dd>
        </div>
        <div>
          <dt>有效执行时间</dt>
          <dd>
            {Math.round(task.elapsedMs / 1000)} 秒 /{' '}
            {limited
              ? `${execution.limits.taskTimeoutMs / 60000} 分钟`
              : '不限'}
          </dd>
        </div>
      </dl>
      <p className="agent-hint">
        以上为本次任务用量，继续时不会清零。新任务可在“任务计划”中设置执行额度。
      </p>
      {resumable && !draft && (
        <button
          disabled={blocked}
          onClick={() => {
            setError('');
            setDraft({
              limits: { ...execution.limits },
              expectedTask: displayedTaskIdentity(job),
            });
          }}
        >
          {limited ? '调整预算并继续' : '继续本次任务'}
        </button>
      )}
      {resumable && offline && (
        <p className="agent-hint">请先上线 AI 角色，再继续任务。</p>
      )}
      {job.taskRequiresReassignment && (
        <p className="agent-error">
          原私聊会话已失效，请重新通过聊天发起任务。
        </p>
      )}
      {draft && resumable && (
        <form
          className="agent-form agents-confirm"
          onSubmit={async (event) => {
            event.preventDefault();
            const limits = draft.limits;
            if (
              limited &&
              (limits.maxTurns <= task.calls ||
                limits.tokenBudget <= task.tokens ||
                limits.taskTimeoutMs <= task.elapsedMs)
            ) {
              setError('各项总额度必须高于本次任务的已用量，请调整后再继续。');
              return;
            }
            setBusy(true);
            setError('');
            try {
              await tasksApi.controlRun(
                execution.runId,
                'resume',
                { ...limits },
                draft.expectedTask,
              );
              setDraft(undefined);
              await onUpdated();
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : '继续任务失败，请重试。',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            填写本次任务的总额度（含已用量），确认后保留已有进度并继续执行。
          </p>
          <fieldset disabled={blocked}>
            {limited && (
              <TaskBudgetFields
                value={draft.limits}
                onChange={(value) =>
                  setDraft({ ...draft, limits: { ...draft.limits, ...value } })
                }
              />
            )}
            <div className="agents-actions">
              <button className="primary">确认并继续</button>
              <button
                type="button"
                onClick={() => {
                  setDraft(undefined);
                  setError('');
                }}
              >
                取消
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {error && (
        <p className="agent-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

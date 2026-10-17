import { useState } from 'react';
import type { ManagedAgentView } from '@voxel/shared';
import {
  AgentScheduleSettings,
  taskScheduleOf,
  type TaskSchedule,
} from './AgentScheduleSettings';

export function TaskHeartbeatForm({
  job,
  busy,
  canEdit,
  onSave,
}: {
  job: ManagedAgentView;
  busy: boolean;
  canEdit: boolean;
  onSave: (schedule: TaskSchedule) => void;
}) {
  const [schedule, setSchedule] = useState(() => taskScheduleOf(job));
  const changed =
    JSON.stringify(schedule) !== JSON.stringify(taskScheduleOf(job));
  return (
    <form
      className="agent-form agents-task-heartbeat"
      aria-label="任务心跳设置"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && canEdit && changed) onSave(schedule);
      }}
    >
      <fieldset disabled={busy || !canEdit}>
        <AgentScheduleSettings value={schedule} onChange={setSchedule} />
        <div className="agents-heartbeat-actions">
          <p className="agent-hint">
            {canEdit
              ? '保存只调整执行间隔，保留任务进度，不会启动或恢复任务。后续任务沿用此设置。'
              : '请先暂停任务，待本轮执行结束后再调整心跳。'}
          </p>
          <button type="submit" disabled={!changed}>
            保存心跳
          </button>
        </div>
      </fieldset>
    </form>
  );
}

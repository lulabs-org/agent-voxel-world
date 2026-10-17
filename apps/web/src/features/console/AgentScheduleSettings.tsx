import type { AgentSettings } from '@voxel/shared';
export type TaskSchedule = Pick<
  AgentSettings,
  'intervalMode' | 'intervalMs' | 'intervalMinMs' | 'intervalMaxMs'
>;
export function taskScheduleOf(value: TaskSchedule): TaskSchedule {
  return {
    intervalMode: value.intervalMode,
    intervalMs: value.intervalMs,
    intervalMinMs: value.intervalMinMs,
    intervalMaxMs: value.intervalMaxMs,
  };
}

export function AgentScheduleSettings({
  value: agent,
  onChange: setAgent,
}: {
  value: TaskSchedule;
  onChange: (value: TaskSchedule) => void;
}) {
  return (
    <div className="agents-form-section">
      <h4>任务心跳</h4>
      <p className="agent-hint">
        每轮结束后按此间隔推进任务，收到消息可提前唤醒。
      </p>
      <div className="agent-grid agents-heartbeat-fields">
        <label>
          间隔方式
          <select
            value={agent.intervalMode}
            onChange={(event) =>
              setAgent({
                ...agent,
                intervalMode: event.target
                  .value as AgentSettings['intervalMode'],
              })
            }
          >
            <option value="fixed">固定间隔</option>
            <option value="random">随机间隔</option>
          </select>
        </label>
        {agent.intervalMode === 'fixed' ? (
          <label>
            心跳间隔（秒）
            <input
              type="number"
              required
              min={1}
              max={60}
              step={0.001}
              value={
                Number.isNaN(agent.intervalMs) ? '' : agent.intervalMs / 1000
              }
              onChange={(event) =>
                setAgent({
                  ...agent,
                  intervalMs: Math.round(event.target.valueAsNumber * 1000),
                })
              }
            />
          </label>
        ) : (
          <div className="agent-grid agents-heartbeat-range">
            <label>
              最短间隔（秒）
              <input
                type="number"
                required
                min={1}
                max={agent.intervalMaxMs / 1000 || 60}
                step={0.001}
                value={
                  Number.isNaN(agent.intervalMinMs)
                    ? ''
                    : agent.intervalMinMs / 1000
                }
                onChange={(event) =>
                  setAgent({
                    ...agent,
                    intervalMinMs: Math.round(
                      event.target.valueAsNumber * 1000,
                    ),
                  })
                }
              />
            </label>
            <label>
              最长间隔（秒）
              <input
                type="number"
                required
                min={agent.intervalMinMs / 1000 || 1}
                max={60}
                step={0.001}
                value={
                  Number.isNaN(agent.intervalMaxMs)
                    ? ''
                    : agent.intervalMaxMs / 1000
                }
                onChange={(event) =>
                  setAgent({
                    ...agent,
                    intervalMaxMs: Math.round(
                      event.target.valueAsNumber * 1000,
                    ),
                  })
                }
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

import type { AgentSettings } from '@voxel/shared';
import type { ConsoleController } from './useConsoleController';

export function AgentScheduleSettings({
  agent,
  setAgent,
}: Pick<ConsoleController, 'agent' | 'setAgent'>) {
  return (
    <div className="agents-form-section">
      <h4>运行设置</h4>
      <p className="agent-hint">
        任务进行中按此间隔检查进展；空闲或等待条件未变化时不调用模型。
      </p>
      <div className="agent-grid">
        <label>
          检查方式
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
            检查间隔（秒）
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
          <div className="agent-grid agents-interval-range">
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

import type { AICharacterSettings } from '@voxel/shared';
import { Clock, Coins, Repeat } from 'lucide-react';

type TaskBudget = Pick<
  AICharacterSettings,
  'maxTurns' | 'tokenBudget' | 'taskTimeoutMs'
>;

export function TaskBudgetFields({
  value: agent,
  onChange: setAgent,
  hideHeading = false,
}: {
  value: TaskBudget;
  onChange: (value: TaskBudget) => void;
  hideHeading?: boolean;
}) {
  return (
    <div className="agents-task-limits">
      {!hideHeading && (
        <>
          <h4>任务额度</h4>
          <p className="agent-hint">
            达到任一上限会暂停，确认追加额度后才继续执行。
          </p>
        </>
      )}
      <div className="agents-task-limits-grid">
        <label className="agents-task-limit-field">
          <span className="agents-field-label">
            <Repeat size={13} className="agents-field-icon" />
            调用上限
          </span>
          <div className="agents-input-with-unit">
            <input
              type="number"
              min={1}
              max={1000}
              required
              value={agent.maxTurns}
              onChange={(e) =>
                setAgent({
                  ...agent,
                  maxTurns: e.target.valueAsNumber,
                })
              }
            />
            <span className="agents-input-unit">次</span>
          </div>
        </label>
        <label className="agents-task-limit-field">
          <span className="agents-field-label">
            <Coins size={13} className="agents-field-icon" />
            token 预算
          </span>
          <div className="agents-input-with-unit">
            <input
              type="number"
              min={1000}
              max={100000000}
              required
              value={agent.tokenBudget ?? 50000}
              onChange={(e) =>
                setAgent({
                  ...agent,
                  tokenBudget: e.target.valueAsNumber,
                })
              }
            />
            <span className="agents-input-unit">tokens</span>
          </div>
        </label>
        <label className="agents-task-limit-field">
          <span className="agents-field-label">
            <Clock size={13} className="agents-field-icon" />
            执行时间上限
          </span>
          <div className="agents-input-with-unit">
            <input
              type="number"
              min={1}
              max={360}
              required
              value={(agent.taskTimeoutMs ?? 900000) / 60000}
              onChange={(e) =>
                setAgent({
                  ...agent,
                  taskTimeoutMs: e.target.valueAsNumber * 60000,
                })
              }
            />
            <span className="agents-input-unit">分钟</span>
          </div>
        </label>
      </div>
    </div>
  );
}

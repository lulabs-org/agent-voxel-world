import type { AICharacterSettings } from '@voxel/shared';
type TaskBudget = Pick<
  AICharacterSettings,
  'maxTurns' | 'tokenBudget' | 'taskTimeoutMs'
>;
export function TaskBudgetFields({
  value: agent,
  onChange: setAgent,
}: {
  value: TaskBudget;
  onChange: (value: TaskBudget) => void;
}) {
  return (
    <div className="agents-task-limits">
      <h4>任务额度</h4>
      <p className="agent-hint">
        达到任一上限会暂停，确认追加额度后才继续执行。
      </p>
      <div className="agent-grid">
        <label>
          任务调用上限
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
        </label>
        <label>
          任务 token 预算
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
        </label>
        <label>
          任务执行时间上限（分钟）
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
        </label>
      </div>
    </div>
  );
}

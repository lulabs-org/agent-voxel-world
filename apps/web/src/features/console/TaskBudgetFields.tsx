import type { AgentSettings } from '@voxel/shared';
export type TaskBudget = Pick<
  AgentSettings,
  'maxTurns' | 'tokenBudget' | 'taskTimeoutMs'
>;
export function taskBudgetOf(value: TaskBudget): TaskBudget {
  return {
    maxTurns: value.maxTurns,
    tokenBudget: value.tokenBudget ?? 50000,
    taskTimeoutMs: value.taskTimeoutMs ?? 900000,
  };
}
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
            max={200}
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
            max={1000000}
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
            max={120}
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

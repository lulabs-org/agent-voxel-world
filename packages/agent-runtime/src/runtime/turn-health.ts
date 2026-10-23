import type { ToolState } from '../cognition/context';
import type { Observation } from '../contracts';
import { worldSignature } from '../perception/observation';
import type { TaskService } from '../task/service';
import type { AgentRunState } from '../task/state';

/**
 * Monitors execution health during decision turns:
 * - Detects consecutive tool errors within a single event loop
 * - Tracks lack of physical progress or repeated failures across turns
 * - Gracefully halts automatic retries by marking the task 'blocked'
 */
export class TurnHealthMonitor {
  private eventFailures = 0;

  recordTurn(o: {
    state: ToolState;
    attached: boolean;
    current: () => boolean;
    memory: AgentRunState;
    service: TaskService;
    hasMessage: boolean;
    launched: boolean;
    observation: Observation;
  }) {
    this.eventFailures = o.state.hadError ? this.eventFailures + 1 : 0;
    if (this.eventFailures >= 3) {
      if (o.attached) o.memory.failures = this.eventFailures;
      o.state.terminal = true;
      o.memory.lastResponse = '连续三轮工具失败，已停止本次事件。';
      if (
        o.attached &&
        o.current() &&
        o.memory.task &&
        !['completed', 'cancelled'].includes(o.memory.task.status)
      ) {
        o.service.finish(o.service.lease(), {
          status: 'blocked',
          reason: o.memory.lastResponse,
        });
      }
      return;
    }
    if (o.hasMessage || o.launched || o.state.terminal) return;
    o.memory.failures = o.state.hadError ? (o.memory.failures ?? 0) + 1 : 0;
    const signature =
      worldSignature(o.observation, 'world') +
      JSON.stringify(o.observation.self);
    o.memory.noProgress =
      signature === o.memory.lastProgress
        ? (o.memory.noProgress ?? 0) + 1
        : 0;
    o.memory.lastProgress = signature;
    if (o.memory.failures >= 3 || o.memory.noProgress >= 3) {
      o.service.finish(o.service.lease(), {
        status: 'blocked',
        reason: '连续三轮失败或没有实际进展，已停止自动重试。',
      });
      o.state.terminal = true;
    }
  }
}

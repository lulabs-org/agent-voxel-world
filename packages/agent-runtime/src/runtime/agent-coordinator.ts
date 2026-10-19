import type { ModelEndpoint } from '../contracts';
import { AgentRuntimeError } from '../errors';
import type { AgentRunState } from '../task/state';
import { cap } from '../task/budget';
import { ConversationRunner } from './conversation-runner';
import { TaskRunner } from './task-runner';
import { runFollowStep } from './follow-step';
import type { RunOptions } from './options';

const running = new WeakSet<AgentRunState>();
/** One serialized execution slot per Agent, shared across host wake-ups. */
export class AgentCoordinator {
  constructor(
    private endpoint: ModelEndpoint,
    private request: typeof fetch,
  ) {}
  async run(o: RunOptions) {
    if (running.has(o.memory))
      throw new AgentRuntimeError('Agent 已在运行。', true);
    running.add(o.memory);
    try {
      o.signal.throwIfAborted();
      const addressed = o.attention?.take();
      if (addressed)
        await new ConversationRunner(this.endpoint, this.request).run(
          o,
          addressed,
        );
      if (o.signal.aborted || o.attention?.pending) return;
      const task = o.memory.task;
      if (!task || !['running', 'waiting'].includes(task.status)) return;
      if (o.memory.follow) {
        const reason = cap(task, o.config);
        if (reason) {
          task.status = 'budget';
          task.reason = reason;
          await o.checkpoint?.();
        } else await runFollowStep(o);
      } else await new TaskRunner(this.endpoint, this.request).run(o);
    } finally {
      running.delete(o.memory);
    }
  }
}

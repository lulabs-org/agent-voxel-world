import type { ModelEndpoint } from '../contracts';
import { AgentRuntimeError } from '../errors';
import type { AgentRunState } from '../task/state';
import { CharacterRunner } from './character-runner';
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
      await new CharacterRunner(this.endpoint, this.request).run(o);
    } finally {
      running.delete(o.memory);
    }
  }
}

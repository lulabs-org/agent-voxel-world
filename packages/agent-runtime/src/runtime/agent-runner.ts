import type { ModelEndpoint } from '../contracts';
import { AgentRuntimeError } from '../errors';
import { defaultEndpoint } from '../models/provider-adapter';
import type { AgentRunState } from '../task/state';
import { CharacterRunner } from './character-runner';
import type { RunOptions } from './options';
export type { RunOptions } from './options';

const running = new WeakSet<AgentRunState>();
/** Stable host entrypoint; one serialized execution slot per Agent, shared across host wake-ups. */
export class AgentRunner {
  constructor(
    private endpoint: ModelEndpoint = defaultEndpoint,
    private request: typeof fetch = fetch,
  ) { }
  async run(options: RunOptions): Promise<void> {
    if (running.has(options.memory))
      throw new AgentRuntimeError('Agent 已在运行。', true);
    running.add(options.memory);
    try {
      options.signal.throwIfAborted();
      await new CharacterRunner(this.endpoint, this.request).run(options);
    } finally {
      running.delete(options.memory);
    }
  }
}

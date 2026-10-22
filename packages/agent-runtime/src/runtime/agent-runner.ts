import type { ModelEndpoint } from '../contracts';
import { defaultEndpoint } from '../models/provider-adapter';
import { AgentCoordinator } from './agent-coordinator';
import type { RunOptions } from './options';
export type { RunOptions } from './options';

/** Stable host entrypoint; scheduling and policy live in dedicated collaborators. */
export class AgentRunner {
  constructor(
    private endpoint: ModelEndpoint = defaultEndpoint,
    private request: typeof fetch = fetch,
  ) {}
  run(options: RunOptions): Promise<void> {
    return new AgentCoordinator(this.endpoint, this.request).run(options);
  }
}

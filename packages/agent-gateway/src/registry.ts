import type { Job } from './types';
/** The sole owner of hosted Agent instances. Never shared with standalone CLI instances. */
export class AgentRegistry extends Map<string, Job> {}

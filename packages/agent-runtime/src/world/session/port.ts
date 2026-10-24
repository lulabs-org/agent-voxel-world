import type { Result } from '../../contracts/action';
import type { Observation } from '../../contracts/observation';

/** Host-independent world session: the only seam between the runtime and a transport. */
export interface AgentSession {
  request<T = Result>(type: string, payload?: unknown): Promise<T>;
  move(x: number, z: number, jump?: boolean): void;
  observe(): Promise<Observation>;
}

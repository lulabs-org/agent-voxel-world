import type { Player } from '@voxel/shared';
import type { Result } from '../contracts/action';
import type { Observation } from '../contracts/observation';
import type { AgentSession } from '../world/session/port';

/** Minimal observation for tests and headless harnesses. */
export function memoryObservation(
  overrides: Partial<Observation> = {},
): Observation {
  const self = {
    id: 'ai',
    name: 'AI',
    kind: 'ai-agent',
    connected: true,
    x: 0,
    y: 2.5,
    z: 0,
    yaw: 0,
  } satisfies Player;
  return {
    id: 'memory',
    revision: 1,
    self,
    players: [self],
    blocks: [],
    events: [],
    radius: 8,
    allowedActions: [],
    ...overrides,
  };
}

/** In-memory AgentSession: records requests/moves and replays a fixed world. */
export class MemorySession implements AgentSession {
  observation: Observation;
  readonly requests: { type: string; payload: unknown }[] = [];
  readonly moves: { x: number; z: number; jump: boolean }[] = [];
  handler?: (type: string, payload: unknown) => unknown;

  constructor(observation: Observation = memoryObservation()) {
    this.observation = observation;
  }

  async observe() {
    return structuredClone(this.observation);
  }

  move(x: number, z: number, jump = false) {
    this.moves.push({ x, z, jump });
  }

  async request<T = Result>(type: string, payload?: unknown): Promise<T> {
    this.requests.push({ type, payload });
    if (this.handler) return this.handler(type, payload) as T;
    if (type === 'observe') return structuredClone(this.observation) as T;
    return {
      id: `memory-${this.requests.length}`,
      ok: true,
      revision: this.observation.revision,
    } as T;
  }
}

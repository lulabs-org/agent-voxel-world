import type { AICharacterTask } from '@voxel/shared';
import type { Observation } from '../../contracts/observation';

/** Model-facing and identity-facing projections of one observation. */
export function worldView(o: Observation) {
  return {
    revision: o.revision,
    self: o.self,
    radius: o.radius,
    players: o.players.slice(0, 16),
    blocks: o.blocks.slice(0, 500).map((b) => [b.x, b.y, b.z, b.material]),
    events: o.events.slice(-12),
    attention: o.attention,
  };
}

/** Stable identity of the world facts a waiting task is watching. */
export function worldSignature(
  o: Observation,
  kind: AICharacterTask['waitFor'],
) {
  return JSON.stringify(
    kind === 'players'
      ? (o.players ?? [])
          .map((p) => [
            p.id,
            Math.round(p.x * 2),
            Math.round(p.y * 2),
            Math.round(p.z * 2),
            p.connected,
          ])
          .sort()
      : (o.blocks ?? []).map((b) => [b.x, b.y, b.z, b.material]).sort(),
  );
}

import { distance, key, type Vec3 } from '@voxel/shared';
import type { PlannedEdit } from '../../contracts/action';
import type { Observation } from '../../contracts/observation';

const OBSERVATION_LIMIT = 500;

/** Position predicate shared by navigation and effect reconciliation. */
export const arrived = (o: Observation, target: Vec3, radius = 0.18) =>
  !!o.motion?.grounded &&
  Math.abs(o.self.y - target.y) < 0.15 &&
  Math.hypot(o.self.x - target.x, o.self.z - target.z) <= radius;

/** Absence is evidence only inside the observed radius AND the nearest-block cutoff. */
export function observedEmpty(observation: Observation, block: PlannedEdit) {
  const d = distance(observation.self, block);
  const maxDist = Math.max(
    ...observation.blocks.map((b) => distance(observation.self, b)),
  );
  return (
    d <= observation.radius &&
    !observation.blocks.some((b) => key(b) === key(block)) &&
    (observation.blocks.length < OBSERVATION_LIMIT || d < maxDist)
  );
}

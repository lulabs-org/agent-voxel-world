import {
  collides,
  key,
  LIMIT,
  MAX_Y,
  type LocalCollisionMap,
  type Vec3,
} from '@voxel/shared';
import type { Observation } from '../../contracts';

/** Unknown space is solid to the navigator, even when it is absent from blocks. */
export class CollisionMap {
  readonly blocks;
  constructor(readonly data: LocalCollisionMap) {
    this.blocks = new Map(data.blocks.map((b) => [key(b), b]));
  }
  known(p: Vec3) {
    return ['x', 'y', 'z'].every((axis) => {
      const a = axis as keyof Vec3;
      return p[a] >= this.data.min[a] && p[a] <= this.data.max[a];
    });
  }
  clear(p: Vec3) {
    // Include the entire swept body's voxel footprint, not only its center.
    const min = {
      x: Math.floor(p.x + 0.2),
      y: Math.floor(p.y + 0.5),
      z: Math.floor(p.z + 0.2),
    };
    const max = {
      x: Math.floor(p.x + 0.8),
      y: Math.floor(p.y + 2.2),
      z: Math.floor(p.z + 0.8),
    };
    // Above MAX_Y is known air; outside horizontal world bounds stays blocked.
    max.y = Math.min(MAX_Y, max.y);
    min.y = Math.min(MAX_Y, min.y);
    return this.known(min) && this.known(max) && !collides(p, this.blocks);
  }
  stand(p: Vec3) {
    const support = {
      x: Math.round(p.x),
      y: Math.round(p.y - 0.5),
      z: Math.round(p.z),
    };
    return (
      this.known(support) && this.blocks.has(key(support)) && this.clear(p)
    );
  }
  node(p: Vec3): Vec3 {
    return {
      x: Math.round(p.x),
      y: Math.round(p.y - 0.5) + 0.501,
      z: Math.round(p.z),
    };
  }
}

export function collisionMap(o: Observation): CollisionMap | undefined {
  const data = o.navigation;
  if (!data?.complete || data.revision !== o.revision || !o.motion) return;
  for (const axis of ['x', 'y', 'z'] as const) {
    if (
      !Number.isInteger(data.min[axis]) ||
      !Number.isInteger(data.max[axis]) ||
      data.max[axis] < data.min[axis] ||
      data.max[axis] - data.min[axis] > 16
    )
      return;
  }
  if (
    data.min.x < -LIMIT ||
    data.max.x > LIMIT ||
    data.min.z < -LIMIT ||
    data.max.z > LIMIT ||
    data.min.y < 0 ||
    data.max.y > MAX_Y
  )
    return;
  return new CollisionMap(data);
}

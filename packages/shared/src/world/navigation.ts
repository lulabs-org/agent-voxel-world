import type { Block, Vec3 } from './core';

/** Every voxel center inside these inclusive bounds is known, including air. */
export type LocalCollisionMap = {
  complete: true;
  revision: number;
  min: Vec3;
  max: Vec3;
  blocks: Block[];
};

import { LIMIT, MAX_Y, type Vec3 } from './core';

/** Serializes an integer cell coordinate into a Map key, e.g. "1,-2,3". */
export const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;

/** Euclidean distance between two points, in world units. */
export const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * True if `p` is a valid block cell: integer coordinates within the
 * playable volume, i.e. |x|/|z| <= LIMIT and 0 <= y <= MAX_Y.
 */
export const inBounds = (p: Vec3) =>
  Number.isInteger(p.x) &&
  Number.isInteger(p.y) &&
  Number.isInteger(p.z) &&
  Math.abs(p.x) <= LIMIT &&
  Math.abs(p.z) <= LIMIT &&
  p.y >= 0 &&
  p.y <= MAX_Y;

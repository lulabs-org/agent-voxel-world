import { LIMIT, MAX_Y, type Vec3 } from './world';
export const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
export const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const inBounds = (p: Vec3) =>
  Number.isInteger(p.x) &&
  Number.isInteger(p.y) &&
  Number.isInteger(p.z) &&
  Math.abs(p.x) <= LIMIT &&
  Math.abs(p.z) <= LIMIT &&
  p.y >= 0 &&
  p.y <= MAX_Y;

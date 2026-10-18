import { setImmediate as yieldLoop } from 'node:timers/promises';
import { key, simulate, type Vec3 } from '@voxel/shared';
import type { CollisionMap } from './local-map';

export type Waypoint = Vec3 & { jump: boolean };
export type PathResult = {
  path: Waypoint[];
  partial: boolean;
  expanded: number;
  code?: 'no_path_in_known_area' | 'search_budget';
  slices: number;
  maxSliceMs: number;
};
type Node = { p: Vec3; g: number; f: number; parent?: Node; jump: boolean };
class Heap {
  items: Node[] = [];
  push(n: Node) {
    let i = this.items.length;
    this.items.push(n);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].f <= n.f) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = n;
  }
  pop() {
    const first = this.items[0],
      tail = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let c = i * 2 + 1;
        if (c + 1 < this.items.length && this.items[c + 1].f < this.items[c].f)
          c++;
        if (tail.f <= this.items[c].f) break;
        this.items[i] = this.items[c];
        i = c;
      }
      this.items[i] = tail;
    }
    return first;
  }
}
export function steering(from: Vec3, to: Vec3) {
  const dx = to.x - from.x,
    dz = to.z - from.z;
  const scale = Math.max(0.4, Math.hypot(dx, dz));
  return { x: dx / scale, z: dz / scale };
}

/** Validate an edge with the same collision integration and speed as the server. */
export function traversable(map: CollisionMap, from: Vec3, to: Vec3) {
  if (Math.abs(from.y - to.y) < 0.1) {
    // Straight axis-aligned edges between supported cells have no vertical motion.
    return map.clear({
      x: (from.x + to.x) / 2,
      y: from.y,
      z: (from.z + to.z) / 2,
    });
  }
  const body = { ...from, vy: 0, grounded: true };
  const jump = to.y - from.y > 0.5;
  for (let tick = 0; tick < 30; tick++) {
    const input = steering(body, to);
    simulate(
      body,
      { ...input, yaw: 0, jump: jump && tick === 0 },
      map.blocks,
      0.05,
    );
    if (!map.clear(body)) return false;
    if (
      body.grounded &&
      Math.hypot(body.x - to.x, body.z - to.z) < 0.08 &&
      Math.abs(body.y - to.y) < 0.1
    )
      return true;
  }
  return false;
}

/** Grounded four-neighbor A*, with bounded work slices so timers can still run. */
export async function findPath(
  map: CollisionMap,
  start: Vec3,
  goal: Vec3,
  signal: AbortSignal,
  blocked = new Set<string>(),
  goalRadius = 0,
): Promise<PathResult> {
  const source = map.node(start),
    target = map.node(goal);
  const open = new Heap(),
    best = new Map<string, number>();
  const h = (p: Vec3) =>
    Math.max(0, Math.hypot(p.x - goal.x, p.z - goal.z) - goalRadius);
  const root: Node = { p: source, g: 0, f: h(source), jump: false };
  open.push(root);
  best.set(key(source), 0);
  let nearest = root,
    reached: Node | undefined,
    expanded = 0,
    slices = 1;
  let sliceStart = performance.now(),
    maxSliceMs = 0;
  while (open.items.length && expanded < 4096) {
    signal.throwIfAborted();
    const current = open.pop();
    if (current.g !== best.get(key(current.p))) continue;
    expanded++;
    if (
      goalRadius > 0
        ? Math.abs(current.p.y - goal.y) < 0.15 && h(current.p) === 0
        : key(current.p) === key(target)
    ) {
      reached = current;
      break;
    }
    if (h(current.p) < h(nearest.p)) nearest = current;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      for (const dy of [0, 1, -1]) {
        const p = {
          x: current.p.x + dx,
          y: Math.round((current.p.y + dy) * 1000) / 1000,
          z: current.p.z + dz,
        };
        const id = key(p),
          cost = current.g + 1 + Math.abs(dy) * 0.5;
        if (
          blocked.has(`${key(current.p)}>${id}`) ||
          (best.get(id) ?? Infinity) <= cost ||
          !map.stand(p)
        )
          continue;
        if (!traversable(map, current.p, p)) continue;
        best.set(id, cost);
        open.push({
          p,
          g: cost,
          f: cost + h(p),
          parent: current,
          jump: dy === 1,
        });
      }
    }
    const elapsed = performance.now() - sliceStart;
    if (elapsed >= 2) {
      maxSliceMs = Math.max(maxSliceMs, elapsed);
      await yieldLoop(undefined, { signal });
      slices++;
      sliceStart = performance.now();
    }
  }
  maxSliceMs = Math.max(maxSliceMs, performance.now() - sliceStart);
  // A locally unreachable known goal is not proof of global impossibility.
  const partial = !reached;
  const endpoint =
    reached ??
    (!map.known({ x: target.x, y: Math.floor(target.y), z: target.z }) &&
    nearest !== root
      ? nearest
      : undefined);
  const path: Waypoint[] = [];
  for (let n = endpoint; n?.parent; n = n.parent)
    path.push({ ...n.p, jump: n.jump });
  path.reverse();
  return {
    path,
    partial,
    expanded,
    slices,
    maxSliceMs,
    ...(!endpoint
      ? {
          code:
            expanded >= 4096
              ? ('search_budget' as const)
              : ('no_path_in_known_area' as const),
        }
      : {}),
  };
}

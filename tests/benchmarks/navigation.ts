import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { collisionMap } from '../../packages/agent-runtime/src/actions/navigation/local-map';
import { findPath } from '../../packages/agent-runtime/src/actions/navigation/voxel-astar';
import { navigationWorld } from '../support/navigation-world';

const durations: number[] = [],
  slices: number[] = [];
for (let i = 0; i < 220; i++) {
  const w = navigationWorld();
  const kind = i % 4;
  if (kind === 1)
    for (let z = -5; z <= 5; z++) for (let y = 3; y <= 7; y++) w.put(2, y, z);
  if (kind === 2) for (let z = -12; z <= 12; z++) w.put(2, 3, z);
  if (kind === 3)
    for (let z = -12; z <= 12; z++) for (let y = 3; y <= 7; y++) w.put(2, y, z);
  const o = w.observe();
  const start = performance.now();
  const map = collisionMap(o)!;
  const path = await findPath(
    map,
    w.body,
    { x: 6, y: 2.5, z: 0 },
    new AbortController().signal,
  );
  if (i >= 20) {
    durations.push(performance.now() - start);
    slices.push(path.maxSliceMs);
  }
  assert.equal(!!path.code, kind === 3);
}
durations.sort((a, b) => a - b);
slices.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      node: process.version,
      cpu: cpus()[0].model,
      samples: durations.length,
      mapAndSearchMs: {
        p50: durations[99],
        p95: durations[189],
        max: durations.at(-1),
      },
      maxComputeSliceMs: slices.at(-1),
    },
    null,
    2,
  ),
);
assert(durations[189] < 5, 'p95 local map + search exceeds 5ms');

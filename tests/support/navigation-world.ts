import {
  key,
  simulate,
  type Block,
  type Input,
  type Vec3,
} from '../../packages/shared/src/index';
import type { Observation } from '@voxel/agent-runtime';

export function navigationWorld(start: Vec3 = { x: 0, y: 2.501, z: 0 }) {
  const blocks = new Map<string, Block>();
  const put = (x: number, y: number, z: number) =>
    blocks.set(key({ x, y, z }), { x, y, z, material: 'stone' });
  for (let x = -12; x <= 12; x++)
    for (let z = -12; z <= 12; z++) for (let y = 0; y <= 2; y++) put(x, y, z);
  const body = { ...start, vy: 0, grounded: true };
  let input: Input = { x: 0, z: 0, jump: false, yaw: 0 };
  let revision = 0;
  let players: Observation['players'] = [];
  const observe = (): Observation => {
    const min = {
      x: Math.max(-12, Math.round(body.x) - 8),
      y: 0,
      z: Math.max(-12, Math.round(body.z) - 8),
    };
    const max = {
      x: Math.min(12, Math.round(body.x) + 8),
      y: Math.min(15, Math.round(body.y) + 8),
      z: Math.min(12, Math.round(body.z) + 8),
    };
    return {
      id: 'test',
      revision,
      radius: 8,
      allowedActions: ['move'],
      events: [],
      self: {
        ...body,
        id: 'ai',
        name: 'ai',
        connected: true,
        kind: 'ai-agent',
        yaw: 0,
      },
      motion: { grounded: body.grounded, vy: body.vy },
      players: structuredClone(players),
      blocks: [...blocks.values()].slice(0, 500),
      navigation: {
        complete: true,
        revision,
        min,
        max,
        blocks: [...blocks.values()].filter(
          (b) =>
            b.x >= min.x &&
            b.x <= max.x &&
            b.z >= min.z &&
            b.z <= max.z &&
            b.y <= max.y,
        ),
      },
    };
  };
  const moves: Input[] = [];
  const session = {
    move(x: number, z: number, jump = false) {
      input = { x, z, jump, yaw: 0 };
      moves.push(input);
    },
    observe: async () => observe(),
    request: async <T>() => observe() as T,
  };
  return {
    body,
    blocks,
    put,
    observe,
    session,
    moves,
    tick: () => simulate(body, input, blocks, 0.05),
    changed: () => revision++,
    players: (value: Observation['players']) => {
      players = value;
    },
  };
}

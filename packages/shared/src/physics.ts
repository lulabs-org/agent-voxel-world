import { LIMIT, type Vec3, type Block, type Input } from './world';
import { key } from './geometry';
export function overlaps(player: Vec3, b: Vec3) {
  return (
    player.x + 0.3 > b.x - 0.5 &&
    player.x - 0.3 < b.x + 0.5 &&
    player.z + 0.3 > b.z - 0.5 &&
    player.z - 0.3 < b.z + 0.5 &&
    player.y + 1.7 > b.y - 0.5 &&
    player.y < b.y + 0.5
  );
}
export function collides(p: Vec3, blocks: Map<string, Block>) {
  if (Math.abs(p.x) > LIMIT - 0.3 || Math.abs(p.z) > LIMIT - 0.3 || p.y < 0.5)
    return true;
  for (
    let x = Math.floor(p.x - 0.3 + 0.5);
    x <= Math.floor(p.x + 0.3 + 0.5);
    x++
  )
    for (
      let z = Math.floor(p.z - 0.3 + 0.5);
      z <= Math.floor(p.z + 0.3 + 0.5);
      z++
    )
      for (let y = Math.floor(p.y + 0.5); y <= Math.floor(p.y + 1.7 + 0.5); y++)
        if (blocks.has(key({ x, y, z })) && overlaps(p, { x, y, z }))
          return true;
  return false;
}
export type Body = Vec3 & { vy: number; grounded: boolean };
export function simulate(
  body: Body,
  input: Input,
  blocks: Map<string, Block>,
  dt: number,
) {
  const mag = Math.max(1, Math.hypot(input.x, input.z));
  for (const axis of ['x', 'z'] as const) {
    const next = { ...body, [axis]: body[axis] + (input[axis] / mag) * 4 * dt };
    if (!collides(next, blocks)) body[axis] = next[axis];
  }
  if (input.jump && body.grounded) {
    body.vy = 7;
    body.grounded = false;
  }
  body.vy = Math.max(-20, body.vy - 20 * dt);
  const dy = body.vy * dt,
    steps = Math.max(1, Math.ceil(Math.abs(dy) / 0.08));
  body.grounded = false;
  for (let i = 0; i < steps; i++) {
    const next = { ...body, y: body.y + dy / steps };
    if (collides(next, blocks)) {
      body.grounded = body.vy <= 0;
      body.vy = 0;
      break;
    }
    body.y = next.y;
  }
}

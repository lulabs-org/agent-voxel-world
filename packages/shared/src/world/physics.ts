import { LIMIT, type Vec3, type Block, type Input } from './core';
import { key } from './geometry';

// Tuning constants for the player body simulation.
const WALK_SPEED = 4; // horizontal speed, units/sec
const JUMP_VELOCITY = 7; // initial upward velocity on jump
const GRAVITY = 20; // downward acceleration, units/sec^2
const MAX_FALL_SPEED = 20; // terminal velocity cap
const MAX_STEP = 0.08; // max vertical movement per sub-step (anti-tunneling)

// Player collision box: PLAYER_HALF_WIDTH * 2 wide on x/z, PLAYER_HEIGHT tall
// from feet (y) to head. Blocks are unit cubes centered on their integer
// coordinate, so each extends BLOCK_HALF in every direction.
const PLAYER_HALF_WIDTH = 0.3;
const PLAYER_HEIGHT = 1.7;
const BLOCK_HALF = 0.5;

/** Returns true if the player's collision box intersects the block at `b`. */
export function overlaps(player: Vec3, b: Vec3) {
  return (
    player.x + PLAYER_HALF_WIDTH > b.x - BLOCK_HALF &&
    player.x - PLAYER_HALF_WIDTH < b.x + BLOCK_HALF &&
    player.z + PLAYER_HALF_WIDTH > b.z - BLOCK_HALF &&
    player.z - PLAYER_HALF_WIDTH < b.z + BLOCK_HALF &&
    player.y + PLAYER_HEIGHT > b.y - BLOCK_HALF &&
    player.y < b.y + BLOCK_HALF
  );
}

/**
 * Enumerates the integer block cells whose cube can intersect the player box
 * at `p` (broad phase). At most 2x2x3 cells; `+ BLOCK_HALF` shifts from
 * player-center space to block-cell space.
 */
function* coveredCells(p: Vec3): Generator<Vec3> {
  const x0 = Math.floor(p.x - PLAYER_HALF_WIDTH + BLOCK_HALF),
    x1 = Math.floor(p.x + PLAYER_HALF_WIDTH + BLOCK_HALF),
    z0 = Math.floor(p.z - PLAYER_HALF_WIDTH + BLOCK_HALF),
    z1 = Math.floor(p.z + PLAYER_HALF_WIDTH + BLOCK_HALF),
    y0 = Math.floor(p.y + BLOCK_HALF),
    y1 = Math.floor(p.y + PLAYER_HEIGHT + BLOCK_HALF);
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++) yield { x, y, z };
}

/**
 * Checks whether the player at `p` collides with any solid block, or with the
 * world boundary walls (|x|/|z| >= LIMIT) and the ground plane below y = 0.
 */
export function collides(p: Vec3, blocks: Map<string, Block>) {
  // Boundary walls and floor: reject positions outside the playable volume.
  if (
    Math.abs(p.x) > LIMIT - PLAYER_HALF_WIDTH ||
    Math.abs(p.z) > LIMIT - PLAYER_HALF_WIDTH ||
    p.y < BLOCK_HALF
  )
    return true;
  // Narrow phase: any covered cell holding a solid block that overlaps wins.
  for (const cell of coveredCells(p))
    if (blocks.has(key(cell)) && overlaps(p, cell)) return true;
  return false;
}

/** A dynamic body: position plus vertical velocity and a grounded flag. */
export type Body = Vec3 & { vy: number; grounded: boolean };

/**
 * Advances the body by one frame: horizontal input with axis-separated
 * collision sliding, then gravity with a jumped/landed vertical sweep.
 * Mutates `body` in place.
 */
export function simulate(
  body: Body,
  input: Input,
  blocks: Map<string, Block>,
  dt: number,
) {
  // Normalize diagonals but clamp small inputs to full speed (mag >= 1).
  const mag = Math.max(1, Math.hypot(input.x, input.z));
  // Move each horizontal axis independently so the player slides along walls.
  for (const axis of ['x', 'z'] as const) {
    const next = {
      ...body,
      [axis]: body[axis] + (input[axis] / mag) * WALK_SPEED * dt,
    };
    if (!collides(next, blocks)) body[axis] = next[axis];
  }
  if (input.jump && body.grounded) {
    body.vy = JUMP_VELOCITY;
    body.grounded = false;
  }
  // Apply gravity, capped at terminal velocity.
  body.vy = Math.max(-MAX_FALL_SPEED, body.vy - GRAVITY * dt);
  // Sweep vertically in sub-steps no larger than MAX_STEP so fast falls
  // can't tunnel through thin floors.
  const dy = body.vy * dt,
    steps = Math.max(1, Math.ceil(Math.abs(dy) / MAX_STEP));
  body.grounded = false;
  for (let i = 0; i < steps; i++) {
    const next = { ...body, y: body.y + dy / steps };
    if (collides(next, blocks)) {
      // Hit something: landing (moving down) sets grounded; stop the sweep.
      body.grounded = body.vy <= 0;
      body.vy = 0;
      break;
    }
    body.y = next.y;
  }
}

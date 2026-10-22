import type { Player } from '../world/core';
export const SPATIAL_RANGE = 18;
/** World forward is (-sin(yaw), 0, -cos(yaw)); front speech carries further. */
export function spatialMix(
  listener: Pick<Player, 'x' | 'y' | 'z' | 'yaw'>,
  speaker: Pick<Player, 'x' | 'y' | 'z' | 'yaw'>,
) {
  const dx = listener.x - speaker.x,
    dy = listener.y - speaker.y,
    dz = listener.z - speaker.z;
  const d = Math.hypot(dx, dy, dz),
    horizontal = Math.hypot(dx, dz);
  const facing =
    horizontal < 0.001
      ? 1
      : (-Math.sin(speaker.yaw) * dx - Math.cos(speaker.yaw) * dz) / horizontal;
  const gain =
    d >= SPATIAL_RANGE
      ? 0
      : (1 - Math.max(0, d - 1) / (SPATIAL_RANGE - 1)) ** 2 *
        (0.35 + (0.65 * (facing + 1)) / 2);
  const pan =
    horizontal < 0.001
      ? 0
      : (-dx * Math.cos(listener.yaw) + dz * Math.sin(listener.yaw)) /
        horizontal;
  return { gain, pan: Math.max(-1, Math.min(1, pan)) };
}

/** Minimum intelligible speech gain; shared with server-side caption routing. */
export const SPEECH_HEARING_THRESHOLD = 0.03;

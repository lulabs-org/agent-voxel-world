import type {
  Block,
  LocalCollisionMap,
  Player,
  WorldEvent,
} from '@voxel/shared';

export type Observation = {
  id: string;
  revision: number;
  self: Player;
  players: Player[];
  blocks: Block[];
  events: WorldEvent[];
  radius: number;
  allowedActions: string[];
  /** Machine-only collision data, never included in model context. */
  navigation?: LocalCollisionMap;
  motion?: { grounded: boolean; vy: number };
  attention?: WorldEvent;
};

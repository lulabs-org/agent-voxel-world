export const WORLD_ID = 'meadow';
export const PROTOCOL_VERSION = 1;
export const LIMIT = 12;
export const MAX_Y = 15;
export const REACH = 6;
export type Material = 'grass' | 'dirt' | 'stone' | 'wood';
export type Vec3 = { x: number; y: number; z: number };
export type Block = Vec3 & { material: Material };
export type Player = Vec3 & {
  id: string;
  name: string;
  kind: string;
  yaw: number;
  connected: boolean;
  voiceSending?: boolean;
  voiceListening?: boolean;
  voiceReplies?: boolean;
};
export type WorldPresence = {
  worldId: string;
  roomId: string;
  revision: number;
  capacity: number;
  persistence: string;
  updatedAt: number;
  players: Player[];
};
export type Input = { x: number; z: number; jump: boolean; yaw: number };
export type Edit = Vec3 & { material: Material | null; revision: number };
export type Snapshot = {
  blocks: Block[];
  revision: number;
  persistence: string;
};
export type WorldEvent = {
  actorKind?: string;
  seq: number;
  type: string;
  actor: string;
  at: number;
  data: unknown;
};

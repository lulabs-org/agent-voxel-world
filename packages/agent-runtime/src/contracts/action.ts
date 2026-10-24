import type { ChatRoute, Material, Vec3 } from '@voxel/shared';

export type Result = {
  id: string;
  ok: boolean;
  error?: string;
  revision: number;
};

export type PlannedEdit = Vec3 & { material: Material | null };

export type BuildAction =
  | { type: 'build'; blocks: PlannedEdit[] }
  | {
      type: 'house';
      x: number;
      y: number;
      z: number;
      width: number;
      depth: number;
      height: number;
      material: Material;
      door: 'north' | 'south' | 'east' | 'west';
    };

export type BuildResult = {
  ok: boolean;
  total: number;
  completed: number;
  skipped: number;
  remaining: PlannedEdit[];
  failures: { block: PlannedEdit; error: string }[];
  note: string;
  /** Edits sent without an acknowledgement; reconcile before retrying. */
  uncertain?: PlannedEdit[];
};

export type AgentAction =
  | BuildAction
  | { type: 'goto'; x: number; y: number; z: number }
  | { type: 'follow'; playerId: string; distance: number }
  | { type: 'wait' }
  | ({ type: 'chat'; text: string } & Partial<ChatRoute>)
  | { type: 'move'; x: number; z: number; jump: boolean; durationMs: number }
  | {
      type: 'edit';
      x: number;
      y: number;
      z: number;
      material: Material | null;
    };

export type NavigationResult = {
  ok: boolean;
  status: 'arrived' | 'following' | 'progress' | 'failed';
  code?:
    | 'map_unavailable'
    | 'target_blocked'
    | 'no_path_in_known_area'
    | 'target_not_visible'
    | 'stalled'
    | 'timeout'
    | 'search_budget';
  note: string;
  position: Vec3;
  target?: Vec3;
  replans: number;
};
export type ActionResult =
  | Result
  | BuildResult
  | NavigationResult
  | { ok: boolean; note: string };
export type ActionExecution = {
  action: AgentAction;
  status:
    | 'pending'
    | 'executing'
    | 'succeeded'
    | 'failed'
    | 'interrupted'
    | 'unknown';
  result?: ActionResult;
  startedAt?: number;
  before?: Vec3;
  after?: Vec3;
};
export type BatchResult = {
  batchId?: string;
  actions: AgentAction[];
  results: ActionExecution[];
  remaining: AgentAction[];
  ok: boolean;
  stopReason:
    | 'executing'
    | 'completed'
    | 'failed'
    | 'message'
    | 'aborted'
    | 'timeout'
    | 'unknown'
    | 'observation_failed'
    | 'movement_stalled';
};

import type {
  AICharacterTask,
  Block,
  LocalCollisionMap,
  Player,
  WorldEvent,
} from '@voxel/shared';
import type { BatchResult } from './action';
import type { EffectsSection, FollowIntent } from './state';

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

/** Everything one decision may see; audience filtering happens before it is built. */
export type DecisionContext = {
  task?: AICharacterTask;
  addressed?: WorldEvent;
  observation: Observation;
  visibleTask?: AICharacterTask;
  privateTo?: string;
  context: {
    task?: AICharacterTask;
    previous?: unknown;
    pendingEffects?: BatchResult;
    follow?: FollowIntent;
    unfinishedBuild?: EffectsSection['unfinishedBuild'];
    decisionError?: string;
    trigger: 'message' | 'condition_changed' | 'task';
  };
};

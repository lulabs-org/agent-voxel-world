import type { AICharacterTask, AICharacterUsage } from '@voxel/shared';
import type { BuildAction, BuildResult, BatchResult } from '../contracts';

export type AgentRunState = {
  version?: 2;
  lastChatAt?: number;
  conversation?: { key: string; state: 'accepted' | 'reply_unknown' | 'done' };
  identity?: { id: string; revision: number; startedAt: number };
  unknownEffect?: { id: string; name: string; state: 'unknown' };
  follow?: {
    action: { type: 'follow'; playerId: string; distance: number };
    taskStartedAt: number;
    pursuing: boolean;
    stalledSlices?: number;
    lastResult?: import('../contracts').NavigationResult;
  };
  pi?: PiCheckpoint;
  task?: AICharacterTask;
  usage?: AICharacterUsage;
  previous?: unknown;
  pendingEffects?: BatchResult;
  lastReply?: BatchResult;
  unfinishedBuild?: { action: BuildAction; result: BuildResult };
  waitSignature?: string;
  failures?: number;
  noProgress?: number;
  lastProgress?: string;
  lastResponse?: string;
  decisionError?: string;
  audienceExpired?: boolean;
};

export function newTask(
  goal: string,
  owner?: string,
  privateTo?: string,
): AICharacterTask {
  return {
    goal,
    owner,
    privateTo,
    status: 'running',
    summary: '任务已接收，等待执行。',
    reason: '',
    calls: 0,
    tokens: 0,
    estimated: false,
    startedAt: Date.now(),
    elapsedMs: 0,
  };
}

/** Restore batch history only; in-flight effects remain unknown and never replay automatically. */
export function restoreBatchHistory(value: unknown): BatchResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as BatchResult;
  if (
    !Array.isArray(candidate.actions) ||
    !Array.isArray(candidate.results) ||
    !Array.isArray(candidate.remaining)
  )
    return undefined;
  const batch = structuredClone(candidate);
  for (const result of batch.results) {
    if (result.status === 'executing') result.status = 'unknown';
  }
  if (batch.stopReason === 'executing') {
    batch.ok = false;
    batch.stopReason = 'unknown';
  }
  return batch;
}

export type PiCheckpoint = {
  version: 1 | 2;
  taskId?: string;
  revision?: number;
  taskStartedAt: number;
  audience: string;
  /** Opaque adapter data; only the Pi boundary interprets model messages. */
  messages: unknown[];
  inFlight?: { id: string; name: string; state: 'executing' | 'unknown' };
};

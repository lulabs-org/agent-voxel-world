import { setTimeout as delay } from 'node:timers/promises';
import type { AgentRunState } from '../task/state';

/** Conversation replies and task reports share the world's per-player rate limit. */
export async function paceChat(memory: AgentRunState, signal: AbortSignal) {
  if (memory.lastChatAt)
    await delay(
      Math.max(0, 350 - (Date.now() - memory.lastChatAt)),
      undefined,
      { signal },
    );
  signal.throwIfAborted();
  memory.lastChatAt = Date.now();
}

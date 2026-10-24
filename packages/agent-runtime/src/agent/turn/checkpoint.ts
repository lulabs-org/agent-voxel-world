import type { Message } from '@earendil-works/pi-ai';
import { restoreBatchHistory, type AgentRunState } from '../task/state';
import { TaskService } from '../task/service';
import { recentTurns } from './window';

/** Model-specific deserialization stays outside task policy and persisted state types. */
export function checkpointMessages(memory: AgentRunState): Message[] {
  return recentTurns((memory.pi?.messages ?? []) as Message[]);
}

/** Migrate both current and archived run states without replaying old tool calls. */
export function restoreCheckpoint(memory: AgentRunState) {
  memory.previous = restoreBatchHistory(memory.previous);
  if (memory.pendingEffects)
    memory.pendingEffects = restoreBatchHistory(memory.pendingEffects);
  const previous = memory.previous as
    | import('../../contracts').BatchResult
    | undefined;
  if (
    !memory.pendingEffects &&
    previous?.results?.some((r) => r.status === 'unknown')
  )
    memory.pendingEffects = structuredClone(previous);
  const saved = memory.pi;
  if (saved?.inFlight)
    memory.unknownEffect = { ...saved.inFlight, state: 'unknown' };
  if (!memory.task) {
    delete memory.pi;
    memory.version = 2;
    return;
  }
  const identity = new TaskService(memory).lease();
  if (
    !saved ||
    ![2, 3].includes(saved.version) ||
    saved.taskId !== identity.id ||
    saved.revision !== identity.revision ||
    saved.taskStartedAt !== memory.task.startedAt ||
    saved.audience !== (memory.task.privateTo ?? 'public')
  ) {
    delete memory.pi;
  } else {
    try {
      saved.messages = checkpointMessages(memory);
    } catch {
      delete memory.pi;
    }
    if (saved.inFlight) saved.inFlight.state = 'unknown';
  }
  memory.version = 2;
}

export function updateCheckpoint(
  memory: AgentRunState,
  messages: Message[],
  apiKey?: string,
) {
  if (!memory.task || ['completed', 'cancelled'].includes(memory.task.status)) {
    delete memory.pi;
    return;
  }
  const identity = new TaskService(memory).lease();
  memory.pi = {
    version: 3,
    taskId: identity.id,
    revision: identity.revision,
    taskStartedAt: memory.task.startedAt,
    audience: memory.task.privateTo ?? 'public',
    messages: recentTurns(messages),
    inFlight: memory.pi?.inFlight,
  };
  if (apiKey)
    memory.pi = JSON.parse(
      JSON.stringify(memory.pi).split(apiKey).join('[已隐藏]'),
    );
}

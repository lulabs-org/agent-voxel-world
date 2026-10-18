import type { Message } from '@earendil-works/pi-ai';
import type { AgentRunState } from '../task/state';
import { recentTurns } from './context';

export function restorePiCheckpoint(memory: AgentRunState) {
  const saved = memory.pi;
  if (
    !saved ||
    saved.version !== 1 ||
    !Array.isArray(saved.messages) ||
    saved.taskStartedAt !== memory.task?.startedAt ||
    saved.audience !== (memory.task?.privateTo ?? 'public')
  ) {
    delete memory.pi;
    return;
  }
  try {
    saved.messages = recentTurns(saved.messages);
  } catch {
    delete memory.pi;
    return;
  }
  if (saved.inFlight) saved.inFlight.state = 'unknown';
}

/** Update the existing checkpoint format without writing to host storage. */
export function updatePiCheckpoint(
  memory: AgentRunState,
  {
    mode,
    messages,
    savedTaskHistory,
    apiKey,
  }: {
    mode: 'reply' | 'task' | undefined;
    messages: Message[];
    savedTaskHistory: Message[];
    apiKey?: string;
  },
) {
  if (
    mode === 'task' &&
    memory.task &&
    !['completed', 'cancelled'].includes(memory.task.status)
  ) {
    memory.pi = {
      version: 1,
      taskStartedAt: memory.task.startedAt,
      audience: memory.task.privateTo ?? 'public',
      messages: recentTurns([...savedTaskHistory, ...messages] as Message[]),
      inFlight: memory.pi?.inFlight,
    };
    if (apiKey)
      memory.pi = JSON.parse(
        JSON.stringify(memory.pi).split(apiKey).join('[已隐藏]'),
      );
  } else if (
    memory.task &&
    ['completed', 'cancelled'].includes(memory.task.status)
  )
    delete memory.pi;
}

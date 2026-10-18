import type { Message } from '@earendil-works/pi-ai';
import type { AgentRunState } from './task';

/** Only complete assistant/tool groups survive trimming or process recovery. */
export function recentTurns(messages: Message[]): Message[] {
  const groups: Message[][] = [];
  for (const message of messages) {
    if (message.role === 'assistant') groups.push([message]);
    else if (message.role === 'toolResult' && groups.length)
      groups.at(-1)!.push(message);
  }
  return groups
    .filter((group) => {
      const assistant = group[0];
      if (
        assistant.role !== 'assistant' ||
        ['error', 'aborted'].includes(assistant.stopReason)
      )
        return false;
      const calls = assistant.content.filter((c) => c.type === 'toolCall');
      return calls.every((c) =>
        group.some((m) => m.role === 'toolResult' && m.toolCallId === c.id),
      );
    })
    .slice(-8)
    .flat();
}
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

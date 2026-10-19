import type { Message } from '@earendil-works/pi-ai';

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

export type ToolState = {
  terminal: boolean;
  skipBatch: boolean;
  hadError: boolean;
  persistenceFailed: boolean;
  turnMutated: boolean;
};

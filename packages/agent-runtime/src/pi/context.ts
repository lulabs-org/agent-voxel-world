import type { TaskDirective } from '../contracts';
import type { AgentRunState } from '../task/state';
import type { DecisionContext } from '../task/observation';
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

/** Mutable state for one invocation, shared by the loop and its sequential tools only. */
export type PiTurnState = {
  prepared: DecisionContext;
  mode: 'reply' | 'task' | undefined;
  terminal: boolean;
  skipBatch: boolean;
  persistenceFailed: boolean;
  responseSent: boolean;
  turnMutated: boolean;
  hadError: boolean;
  turnAdvanced: boolean;
  lastChat: number;
  consecutiveFailures: number;
  directive: TaskDirective;
  restoredTaskHistory: boolean;
};

export function createPiTurnState(
  prepared: DecisionContext,
  memory: AgentRunState,
): PiTurnState {
  return {
    prepared,
    // A message is not a reply until the model explicitly classifies it.
    // Otherwise a premature chat promise terminates the wake before any task exists.
    mode: prepared.addressed ? undefined : 'task',
    terminal: false,
    skipBatch: false,
    persistenceFailed: false,
    responseSent: false,
    turnMutated: false,
    hadError: false,
    turnAdvanced: false,
    lastChat: 0,
    consecutiveFailures: memory.failures ?? 0,
    directive: {
      intent: prepared.addressed ? 'reply' : 'continue',
      status: 'running',
      summary: memory.task?.summary || '执行任务',
    },
    restoredTaskHistory: false,
  };
}

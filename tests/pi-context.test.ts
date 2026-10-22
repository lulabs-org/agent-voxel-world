import { expect, it } from 'vitest';
import { recentInteractions } from '../packages/agent-runtime/src/cognition/context';

it('keeps eight human interactions with all completed tool rounds and no orphan results', () => {
  const messages: Parameters<typeof recentInteractions>[0] = [];
  for (let i = 0; i < 10; i++) {
    messages.push({ role: 'user', content: `question-${i}`, timestamp: i });
    for (let j = 0; j < 2; j++) {
      const id = `${i}-${j}`;
      messages.push({
        role: 'assistant',
        stopReason: 'toolUse',
        content: [{ type: 'toolCall', id, name: 'observe', arguments: {} }],
      } as Parameters<typeof recentInteractions>[0][number]);
      messages.push({
        role: 'toolResult',
        toolCallId: id,
        toolName: 'observe',
        content: [{ type: 'text', text: id }],
        isError: false,
        timestamp: i,
      } as Parameters<typeof recentInteractions>[0][number]);
    }
  }
  messages.push({
    role: 'assistant',
    stopReason: 'toolUse',
    content: [
      { type: 'toolCall', id: 'unfinished', name: 'edit', arguments: {} },
    ],
  } as Parameters<typeof recentInteractions>[0][number]);
  const kept = recentInteractions(messages);
  expect(kept.filter((m) => m.role === 'user')).toHaveLength(8);
  expect(kept.filter((m) => m.role === 'assistant')).toHaveLength(16);
  expect(kept.filter((m) => m.role === 'toolResult')).toHaveLength(16);
  expect(JSON.stringify(kept)).not.toContain('question-1');
  expect(JSON.stringify(kept)).not.toContain('unfinished');
});

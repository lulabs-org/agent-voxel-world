import type { AgentRunState, CharacterEvent } from './state';

/** Record an event into the agent's mailbox, deduplicating and pruning audit history. */
export function recordEvent(memory: AgentRunState, event: CharacterEvent) {
  const inbox = (memory.inbox ??= { version: 1, events: [] });
  const old = inbox.events.find((e) => e.id === event.id);
  if (old) return old;
  inbox.events.push(event);
  // Keep all outstanding inputs and a bounded audit trail.
  const done = inbox.events
    .filter((e) => ['done', 'unknown'].includes(e.state))
    .slice(-64);
  inbox.events = [
    ...inbox.events.filter((e) => !['done', 'unknown'].includes(e.state)),
    ...done,
  ];
  return event;
}

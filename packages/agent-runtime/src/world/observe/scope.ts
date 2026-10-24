import type { ChatData } from '@voxel/shared';
import type { Observation } from '../../contracts';

/** Isolates private/nearby chat events so turns do not leak private recipient messages. */
export function isolateChatScope(observation: Observation) {
  const latest = observation.events
    .filter((e) => e.type === 'chat' && e.actor !== observation.self.id)
    .at(-1);
  const peer =
    latest && ['private', 'nearby'].includes((latest.data as ChatData).scope)
      ? latest.actor
      : undefined;
  return {
    ...observation,
    events: observation.events.filter(
      (e) =>
        e.type !== 'chat' ||
        !['private', 'nearby'].includes((e.data as ChatData).scope) ||
        (peer &&
          (e.actor === peer ||
            (e.actor === observation.self.id &&
              (e.data as ChatData).recipients.length === 1 &&
              (e.data as ChatData).recipients[0] === peer))),
    ),
  };
}

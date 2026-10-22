import { key, type AICharacterTask, type ChatData } from '@voxel/shared';
import type { AgentSession, BatchResult, Observation } from '../contracts';
import type { AgentRunState } from '../task/state';
import { arrived } from '../actions/navigation/controller';
import { observedEmpty } from '../actions/building';

export function worldSignature(
  o: Observation,
  kind: AICharacterTask['waitFor'],
) {
  return JSON.stringify(
    kind === 'players'
      ? (o.players ?? [])
          .map((p) => [
            p.id,
            Math.round(p.x * 2),
            Math.round(p.y * 2),
            Math.round(p.z * 2),
            p.connected,
          ])
          .sort()
      : (o.blocks ?? []).map((b) => [b.x, b.y, b.z, b.material]).sort(),
  );
}

export type DecisionContext = NonNullable<
  Awaited<ReturnType<typeof prepareDecision>>
>;
export async function prepareDecision(
  session: Pick<AgentSession, 'observe'>,
  memory: AgentRunState,
  signal: AbortSignal,
  addressed?: import('@voxel/shared').WorldEvent,
) {
  const task = memory.task;
  const raw = await session.observe();
  signal.throwIfAborted();
  if (
    !addressed &&
    task?.status === 'waiting' &&
    worldSignature(raw, task.waitFor) === memory.waitSignature
  )
    return undefined;
  if (memory.unfinishedBuild) {
    const observed = new Map(
      (raw.blocks ?? []).map((b) => [`${b.x},${b.y},${b.z}`, b.material]),
    );
    const remaining = memory.unfinishedBuild.result.remaining.filter((b) =>
      b.material !== null
        ? observed.get(key(b)) !== b.material
        : !observedEmpty(raw, b),
    );
    if (!remaining.length) memory.unfinishedBuild = undefined;
    else {
      memory.unfinishedBuild.result.remaining = remaining;
      memory.unfinishedBuild.result.uncertain =
        memory.unfinishedBuild.result.uncertain?.filter((b) =>
          remaining.some((p) => key(p) === key(b)),
        );
    }
  }
  if (memory.pendingEffects) {
    const latest = memory.previous as BatchResult | undefined;
    // A verified replacement destination supersedes a known navigation failure.
    // Unknown effects and failed edits still need their own reconciliation.
    const correctedArrival = latest?.results?.some(
      (r) =>
        r.action.type === 'goto' &&
        r.status === 'succeeded' &&
        r.result?.ok &&
        'status' in r.result &&
        r.result.status === 'arrived' &&
        arrived(raw, r.action),
    );
    const resolved = memory.pendingEffects.results
      .filter((r) => !['pending', 'succeeded'].includes(r.status))
      .every((r) => {
        if (r.action.type === 'edit')
          return r.action.material === null
            ? observedEmpty(raw, r.action)
            : raw.blocks.some(
                (b) =>
                  key(b) ===
                    key(r.action as import('../contracts').PlannedEdit) &&
                  b.material ===
                    (r.action as import('../contracts').PlannedEdit).material,
              );
        if (r.action.type === 'goto')
          return (
            arrived(raw, r.action) ||
            (r.status === 'failed' &&
              r.result &&
              'status' in r.result &&
              r.result.status === 'failed' &&
              correctedArrival)
          );
        if (r.action.type === 'follow')
          return (
            !!memory.follow && memory.follow.taskStartedAt === task?.startedAt
          );
        if (r.action.type === 'move')
          return (
            !!r.before &&
            Math.hypot(
              raw.self.x - r.before.x,
              raw.self.y - r.before.y,
              raw.self.z - r.before.z,
            ) >= 0.05
          );
        if (r.action.type === 'build' || r.action.type === 'house')
          return !memory.unfinishedBuild;
        return false;
      });
    if (resolved) {
      const unknown = memory.unknownEffect;
      if (
        unknown &&
        unknown.name !== 'chat' &&
        memory.pendingEffects.results.some(
          (r) => r.action.type === unknown.name,
        )
      ) {
        delete memory.unknownEffect;
        if (memory.pi?.inFlight?.id === unknown.id) delete memory.pi.inFlight;
      }
      delete memory.pendingEffects;
    }
  }
  const message = addressed?.data as ChatData | undefined;
  const privateTo =
    message && ['private', 'nearby'].includes(message.scope)
      ? addressed!.actor
      : undefined;
  // Conversation and task audiences are independent. A public question never sees a private task.
  const visibleTask =
    task &&
    (!task.privateTo || (addressed ? task.privateTo === privateTo : true));
  const observation = {
    ...raw,
    attention: addressed,
    events: addressed ? [addressed] : [],
  };
  const context = {
    task: visibleTask ? task : undefined,
    previous: visibleTask ? memory.previous : undefined,
    pendingEffects: visibleTask ? memory.pendingEffects : undefined,
    follow: visibleTask ? memory.follow : undefined,
    unfinishedBuild: visibleTask ? memory.unfinishedBuild : undefined,
    decisionError: visibleTask ? memory.decisionError : undefined,
    trigger: addressed
      ? 'message'
      : task?.status === 'waiting'
        ? 'condition_changed'
        : 'task',
  };
  return { task, addressed, observation, visibleTask, privateTo, context };
}

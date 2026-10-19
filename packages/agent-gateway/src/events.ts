import type { RestoredAgentRecord, GatewayArchive } from './ports';
export type Change = {
  resource: 'agents' | 'providers' | 'plans' | 'runs';
  planIds?: string[];
  runIds?: string[];
  agentIds: string[];
  version: number;
};
export class GatewayEvents {
  private listeners = new Set<(change: Change) => void>();
  private previous = new Map<string, string>();
  private planState = new Map<string, string>();
  private runState = new Map<string, string>();
  version = 0;
  on(listener: (change: Change) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  commit(records: RestoredAgentRecord[], archive?: GatewayArchive) {
    const next = new Map(records.map((r) => [r.id, JSON.stringify(r)]));
    const ids = [...new Set([...next.keys(), ...this.previous.keys()])].filter(
      (id) => next.get(id) !== this.previous.get(id),
    );
    this.previous = next;
    if (ids.length) this.publish('agents', ids);
    if (archive) {
      const diff = (
        values: { id: string }[],
        previous: Map<string, string>,
      ) => {
        const next = new Map(values.map((v) => [v.id, JSON.stringify(v)]));
        const ids = [...new Set([...next.keys(), ...previous.keys()])].filter(
          (id) => next.get(id) !== previous.get(id),
        );
        previous.clear();
        for (const [id, v] of next) previous.set(id, v);
        return ids;
      };
      const planIds = diff(archive.plans, this.planState),
        runIds = diff(archive.runs, this.runState);
      if (planIds.length) this.publish('plans', [], { planIds });
      if (runIds.length)
        this.publish('runs', [], {
          runIds,
          planIds: [
            ...new Set(
              archive.runs
                .filter(
                  (r) =>
                    runIds.includes(r.id) && r.planId && r.source !== 'chat',
                )
                .map((r) => r.planId!),
            ),
          ],
        });
    }
  }
  publish(
    resource: Change['resource'],
    agentIds: string[] = [],
    details: { planIds?: string[]; runIds?: string[] } = {},
  ) {
    const c = { resource, agentIds, ...details, version: ++this.version };
    for (const listener of this.listeners) {
      try {
        listener(c);
      } catch {
        /* A subscriber cannot fail a committed write. */
      }
    }
  }
  close() {
    this.listeners.clear();
  }
}

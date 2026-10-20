import type { RestoredAgentRecord, AgentArchive } from './agent-ports';

export type AgentResourceChange = {
  resource: 'agents' | 'providers' | 'plans' | 'runs';
  planIds?: string[];
  runIds?: string[];
  agentIds: string[];
  version: number;
};

export type Change = AgentResourceChange;

export class AgentEvents {
  private listeners = new Set<(change: AgentResourceChange) => void>();
  private previous = new Map<string, string>();
  private planState = new Map<string, string>();
  private runState = new Map<string, string>();
  version = 0;

  on(listener: (change: AgentResourceChange) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  commit(records: RestoredAgentRecord[], archive?: AgentArchive) {
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
    resource: AgentResourceChange['resource'],
    agentIds: string[] = [],
    details: { planIds?: string[]; runIds?: string[] } = {},
  ) {
    const c: AgentResourceChange = { resource, agentIds, ...details, version: ++this.version };
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

/** Backward-compatibility alias */
export { AgentEvents as GatewayEvents };

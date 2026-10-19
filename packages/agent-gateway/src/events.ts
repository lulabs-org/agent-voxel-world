import type { RestoredAgentRecord } from './ports';
export type Change = {
  resource: 'agents' | 'providers';
  agentIds: string[];
  version: number;
};
export class GatewayEvents {
  private listeners = new Set<(change: Change) => void>();
  private previous = new Map<string, string>();
  version = 0;
  on(listener: (change: Change) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  commit(records: RestoredAgentRecord[]) {
    const next = new Map(records.map((r) => [r.id, JSON.stringify(r)]));
    const ids = [...new Set([...next.keys(), ...this.previous.keys()])].filter(
      (id) => next.get(id) !== this.previous.get(id),
    );
    this.previous = next;
    if (ids.length) this.publish('agents', ids);
  }
  publish(resource: Change['resource'], agentIds: string[] = []) {
    const c = { resource, agentIds, version: ++this.version };
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

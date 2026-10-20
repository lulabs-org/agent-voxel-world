/** Timer only selects due work. AgentWakeScheduler manages timers for agents. */
export class AgentWakeScheduler {
  private agents = new Map<string, ReturnType<typeof setTimeout>>();
  private stopped = false;

  cancel(id: string) {
    clearTimeout(this.agents.get(id));
    this.agents.delete(id);
  }

  wake(id: string, ms: number, action: () => void) {
    this.cancel(id);
    if (this.stopped) return;
    const timer = setTimeout(() => {
      this.agents.delete(id);
      action();
    }, ms);
    timer.unref();
    this.agents.set(id, timer);
  }

  close() {
    this.stopped = true;
    for (const id of this.agents.keys()) this.cancel(id);
  }
}

/** Backward-compatibility alias */
export { AgentWakeScheduler as GatewayScheduler };

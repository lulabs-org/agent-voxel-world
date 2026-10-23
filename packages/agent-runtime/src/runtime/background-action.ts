import type { AgentAttention } from '../perception/attention';

export interface BackgroundActionEntry {
  id: string;
  controller: AbortController;
  settled: boolean;
  done: Promise<void>;
}

/**
 * Manages the single background action execution slot for an Agent.
 * Tracks asynchronous long-running actions (goto, build, house) and enables
 * cooperative cancellation, settlement detection, and attention waiting.
 */
export class BackgroundActionTracker {
  private current?: BackgroundActionEntry;

  get isRunning(): boolean {
    return !!this.current;
  }

  get isSettled(): boolean {
    return !!this.current?.settled;
  }

  launch(id: string, controller: AbortController, work: Promise<void>): void {
    const entry: BackgroundActionEntry = {
      id,
      controller,
      settled: false,
      done: work.finally(() => {
        entry.settled = true;
      }),
    };
    this.current = entry;
  }

  async complete(): Promise<void> {
    if (this.current) {
      await this.current.done;
      this.current = undefined;
    }
  }

  async stop(): Promise<void> {
    this.current?.controller.abort();
    await this.complete();
  }

  async wait(
    attention: AgentAttention | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.current || this.current.settled) return;

    await (attention
      ? Promise.race([this.current.done, attention.wait(60_000, signal)])
      : this.current.done);
  }

  async cleanup(): Promise<void> {
    await this.stop();
  }
}

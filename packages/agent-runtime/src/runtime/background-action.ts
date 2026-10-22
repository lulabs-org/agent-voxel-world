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

  launch(id: string, controller: AbortController, work: Promise<void>) {
    const entry: BackgroundActionEntry = {
      id,
      controller,
      settled: false,
      done: Promise.resolve(),
    };
    entry.done = work.finally(() => {
      entry.settled = true;
    });
    this.current = entry;
  }

  async stop(): Promise<void> {
    if (this.current) {
      this.current.controller.abort();
      await this.current.done;
      this.current = undefined;
    }
  }

  async complete(): Promise<void> {
    if (this.current) {
      await this.current.done;
      this.current = undefined;
    }
  }

  async wait(
    attention: AgentAttention | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.current) return;
    if (!this.current.settled) {
      if (attention) {
        await Promise.race([
          this.current.done,
          attention.wait(60000, signal),
        ]);
      } else {
        await this.current.done;
      }
    }
  }

  async cleanup(): Promise<void> {
    await this.stop();
  }
}

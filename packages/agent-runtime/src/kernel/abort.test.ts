import { describe, expect, it, vi } from 'vitest';
import { cancellable, mergeSignals, withDeadline } from './abort';

describe('kernel abort primitives', () => {
  it('merges signals without wrapping a single one', () => {
    const only = new AbortController().signal;
    expect(mergeSignals(only)).toBe(only);

    const first = new AbortController();
    const second = new AbortController();
    const merged = mergeSignals(first.signal, undefined, second.signal);
    expect(merged.aborted).toBe(false);
    second.abort('stop');
    expect(merged.aborted).toBe(true);
  });

  it('expires independently from the parent signal', () => {
    vi.useFakeTimers();
    try {
      const parent = new AbortController();
      const deadline = withDeadline(parent.signal, 50);
      vi.advanceTimersByTime(49);
      expect(deadline.expired).toBe(false);
      vi.advanceTimersByTime(1);
      expect(deadline.expired).toBe(true);
      expect(deadline.signal.aborted).toBe(true);
      deadline.clear();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not report expiration when the parent aborts', () => {
    const parent = new AbortController();
    const deadline = withDeadline(parent.signal, 60_000);
    parent.abort('cancelled');
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.expired).toBe(false);
    deadline.clear();
  });

  it('stops firing after clear', () => {
    vi.useFakeTimers();
    try {
      const deadline = withDeadline(new AbortController().signal, 10);
      deadline.clear();
      vi.advanceTimersByTime(20);
      expect(deadline.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a parked wait on abort without losing the original result type', async () => {
    const controller = new AbortController();
    const pending = cancellable(
      new Promise<string>(() => {}),
      controller.signal,
    );
    const assertion = expect(pending).rejects.toBe('cancelled');
    controller.abort('cancelled');
    await assertion;
  });
});

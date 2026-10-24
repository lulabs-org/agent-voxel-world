/** Stop awaiting without treating an already dispatched effect as unsent. */
export async function cancellable<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let abort!: () => void;
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([work, stopped]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export type Deadline = {
  readonly signal: AbortSignal;
  /** True only when this deadline fired, never when the parent was aborted. */
  readonly expired: boolean;
  clear(): void;
};

/** Compose a parent signal with a bounded lifetime; always release the timer. */
export function withDeadline(
  parent: AbortSignal,
  ms: number,
  reason = 'deadline',
): Deadline {
  const controller = new AbortController();
  let expired = false;
  const onAbort = () => controller.abort(parent.reason);
  if (parent.aborted) onAbort();
  else parent.addEventListener('abort', onAbort, { once: true });
  const timer = Number.isFinite(ms)
    ? setTimeout(
        () => {
          expired = true;
          controller.abort(reason);
        },
        Math.max(1, ms),
      )
    : undefined;
  return {
    signal: controller.signal,
    get expired() {
      return expired;
    },
    clear() {
      clearTimeout(timer);
      parent.removeEventListener('abort', onAbort);
    },
  };
}

/** One composition helper so callers never hand-roll `AbortSignal.any`. */
export function mergeSignals(
  ...signals: (AbortSignal | undefined)[]
): AbortSignal {
  const list = signals.filter((signal): signal is AbortSignal => !!signal);
  return list.length === 1 ? list[0]! : AbortSignal.any(list);
}

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

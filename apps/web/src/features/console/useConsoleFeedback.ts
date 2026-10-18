import { useRef, useState } from 'react';
export function useConsoleFeedback() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const mutation = useRef(false);
  const jobsRevision = useRef(0);
  const perform = async (operation: () => Promise<void>) => {
    if (mutation.current) return;
    mutation.current = true;
    jobsRevision.current++;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  return {
    busy,
    notice,
    setNotice,
    error,
    setError,
    mutation,
    jobsRevision,
    perform,
  };
}
export type ConsoleFeedback = ReturnType<typeof useConsoleFeedback>;

import { createContext, useContext, useEffect, useRef } from 'react';

type Feedback = {
  setError: (message: string) => void;
  setNotice: (message: string) => void;
};
export const ConsoleFeedbackContext = createContext<Feedback | null>(null);

/** Forward new local feedback to the console's viewport-level toast. */
export function ConsoleFeedbackRelay({
  error = '',
  notice = '',
  active = true,
}: {
  error?: string;
  notice?: string;
  active?: boolean;
}) {
  const feedback = useContext(ConsoleFeedbackContext);
  const previous = useRef({ error: '', notice: '' });
  useEffect(() => {
    if (active && feedback) {
      if (error && error !== previous.current.error) {
        feedback.setNotice('');
        feedback.setError(error);
      } else if (notice && notice !== previous.current.notice) {
        feedback.setError('');
        feedback.setNotice(notice);
      }
    }
    previous.current = { error, notice };
  }, [active, error, notice, feedback]);
  return null;
}

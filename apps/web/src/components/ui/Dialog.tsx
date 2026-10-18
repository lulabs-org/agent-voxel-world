import { useEffect, useRef, type ComponentProps, type RefObject } from 'react';
/** Own only native modal/focus lifecycle. Children remain mounted while closed. */
export function Dialog({
  open,
  initialFocus,
  preventScroll = false,
  ...props
}: Omit<ComponentProps<'dialog'>, 'open' | 'ref'> & {
  open: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  preventScroll?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const element = ref.current!;
    const previous = document.activeElement;
    element.showModal();
    initialFocus?.current?.focus({ preventScroll });
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll });
    };
  }, [open, initialFocus, preventScroll]);
  return <dialog ref={ref} {...props} />;
}

import * as RadixDialog from '@radix-ui/react-dialog';
import type { ComponentProps, RefObject } from 'react';

/** Standardized Dialog primitive backed by Radix UI with full a11y, focus trap, and portal isolation. */
export function Dialog({
  open,
  children,
  className,
  id,
  initialFocus,
  onCancel,
  preventScroll: _preventScroll,
  ...props
}: Omit<ComponentProps<typeof RadixDialog.Content>, 'ref' | 'onCancel'> & {
  open: boolean;
  onClose?: ComponentProps<'dialog'>['onClose'];
  onCancel?: (event: Pick<Event, 'preventDefault' | 'stopPropagation'>) => void;
  initialFocus?: RefObject<HTMLElement | null>;
  preventScroll?: boolean;
}) {
  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && onCancel) {
          onCancel(new Event('cancel', { cancelable: true }));
        }
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="agent-dialog-backdrop" />
        <RadixDialog.Content
          id={id}
          className={className}
          onOpenAutoFocus={(e) => {
            if (initialFocus?.current) {
              e.preventDefault();
              initialFocus.current.focus();
            }
          }}
          onEscapeKeyDown={(e) => {
            if (onCancel) {
              onCancel(e);
            }
          }}
          onPointerDownOutside={(e) => {
            if (onCancel) {
              onCancel(e);
            }
          }}
          {...props}
        >
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

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
  ...props
}: Omit<ComponentProps<'dialog'>, 'open' | 'ref'> & {
  open: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  preventScroll?: boolean;
}) {
  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && onCancel) {
          onCancel({} as any);
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
              onCancel(e as any);
            }
          }}
          onPointerDownOutside={(e) => {
            if (onCancel) {
              onCancel(e as any);
            }
          }}
          {...(props as any)}
        >
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

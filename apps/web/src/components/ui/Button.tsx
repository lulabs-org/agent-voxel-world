import type { ComponentProps } from 'react';
/** Native button semantics and refs; styling belongs to the caller. */
export function Button({
  type = 'button',
  ...props
}: ComponentProps<'button'>) {
  return <button type={type} {...props} />;
}

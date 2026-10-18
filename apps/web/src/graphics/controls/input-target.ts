export function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      'input, textarea, button, select, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
    )
  );
}

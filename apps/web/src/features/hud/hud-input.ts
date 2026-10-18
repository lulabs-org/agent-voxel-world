import type { Material } from '@voxel/shared';

export const MATERIALS: Material[] = ['grass', 'dirt', 'stone', 'wood'];
export const MATERIAL_LABELS: Record<Material, string> = {
  grass: '草方块',
  dirt: '泥土',
  stone: '石头',
  wood: '木材',
};

export function hudShortcut(
  event: Pick<
    KeyboardEvent,
    | 'key'
    | 'code'
    | 'isComposing'
    | 'keyCode'
    | 'repeat'
    | 'ctrlKey'
    | 'altKey'
    | 'metaKey'
    | 'defaultPrevented'
  >,
  interactive: boolean,
  dialogOpen: boolean,
): 'chat' | Material | undefined {
  if (
    interactive ||
    dialogOpen ||
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.repeat ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey
  )
    return;
  if (event.key === 'Enter') return 'chat';
  const index = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(event.code);
  return index >= 0 ? MATERIALS[index] : undefined;
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      'input, textarea, button, select, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
    )
  );
}

import type { Material } from '@voxel/shared';
import { useEffect } from 'react';
import { isInteractiveTarget } from '../../../graphics/controls/input-target';
import { hudShortcut } from '../hud-input';
import type { HudController } from './useHudController';
export function useGameShortcuts(
  joined: boolean,
  hud: HudController,
  setMaterial: (material: Material) => void,
) {
  const {
    activePanel,
    setActivePanel,
    voiceExpanded,
    chatExpanded,
    changeVoice,
    changeChat,
  } = hud;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !joined ||
        document.querySelector('dialog[open]') ||
        event.defaultPrevented ||
        event.isComposing
      )
        return;
      if (event.key === 'Escape') {
        if (activePanel) {
          setActivePanel(null);
          document
            .querySelector<HTMLButtonElement>(
              activePanel === 'players'
                ? '[aria-controls="world-panel"]'
                : '[aria-controls="game-menu"]',
            )
            ?.focus();
        } else if (voiceExpanded) changeVoice(false);
        else if (chatExpanded) changeChat(false);
        return;
      }
      const shortcut = hudShortcut(
        event,
        isInteractiveTarget(event.target),
        !!activePanel,
      );
      if (shortcut === 'chat') {
        event.preventDefault();
        changeChat(true);
      } else if (shortcut) {
        event.preventDefault();
        setMaterial(shortcut);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });
}

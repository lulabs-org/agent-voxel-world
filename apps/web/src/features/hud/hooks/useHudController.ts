import { useState } from 'react';
import { releasePointerLock } from '../../../graphics/controls/pointer-lock';
export function useHudController() {
  const [activePanel, setActivePanel] = useState<
    'players' | 'menu' | 'help' | null
  >(null);
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const changeChat = (expanded: boolean) => {
    if (!expanded && chatBusy) return;
    if (expanded) releasePointerLock();
    setChatExpanded(expanded);
  };
  const togglePanel = (panel: 'players' | 'menu' | 'help') => {
    releasePointerLock();
    setActivePanel((previous) => (previous === panel ? null : panel));
  };
  return {
    activePanel,
    setActivePanel,
    showCoordinates,
    setShowCoordinates,
    chatExpanded,
    chatBusy,
    setChatBusy,
    setChatExpanded,
    changeChat,
    togglePanel,
  };
}
export type HudController = ReturnType<typeof useHudController>;

import { useEffect, useState } from 'react';
import { releasePointerLock } from '../../../graphics/controls/pointer-lock';
export function useHudController(narrow: boolean) {
  const [activePanel, setActivePanel] = useState<
    'players' | 'menu' | 'help' | null
  >(null);
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [voiceExpanded, setVoiceExpanded] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  useEffect(() => {
    if (narrow && chatExpanded) setVoiceExpanded(false);
  }, [narrow, chatExpanded]);
  const changeChat = (expanded: boolean) => {
    if (!expanded && chatBusy) return;
    if (expanded) {
      releasePointerLock();
      if (narrow) setVoiceExpanded(false);
    }
    setChatExpanded(expanded);
  };
  const changeVoice = (expanded: boolean) => {
    if (expanded && narrow && chatBusy) return;
    if (expanded) {
      releasePointerLock();
      if (narrow) setChatExpanded(false);
    }
    setVoiceExpanded(expanded);
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
    voiceExpanded,
    chatBusy,
    setChatBusy,
    setChatExpanded,
    setVoiceExpanded,
    changeChat,
    changeVoice,
    togglePanel,
  };
}
export type HudController = ReturnType<typeof useHudController>;

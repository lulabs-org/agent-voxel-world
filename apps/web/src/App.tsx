import { useState } from 'react';
import { GameHUDLayout } from './components/layout/GameHUDLayout';
import { LobbyLayout } from './components/layout/LobbyLayout';
import { ChatPanel } from './features/chat';
import { ControlConsole } from './features/console';
import {
  GameFooter,
  GameHeader,
  GameMenu,
  MATERIAL_LABELS,
  useGameShortcuts,
  useHudController,
} from './features/hud';
import { SpatialVoicePanel } from './features/voice';
import {
  LobbyCard,
  useWorldScene,
  useWorldSession,
  WorldPanel,
} from './features/world';
import { releasePointerLock } from './graphics/controls/pointer-lock';
import { useViewportAdjust } from './hooks/useViewportAdjust';
import type { Connection } from './network/connection';
export function App({ connection }: { connection: Connection }) {
  const [consoleEntry, setConsoleEntry] = useState<{
    initialTab?: 'characters';
  } | null>(null);
  const { narrow, shortViewport, mainRef } = useViewportAdjust();
  const hud = useHudController(narrow);
  const {
    activePanel,
    setActivePanel,
    showCoordinates,
    chatExpanded,
    voiceExpanded,
    chatBusy,
    setChatBusy,
    changeChat,
    changeVoice,
    togglePanel,
  } = hud;
  const { hostRef, target, material, setMaterial, editBlock, leaveWorldScene } =
    useWorldScene(connection);
  const session = useWorldSession(connection, leaveWorldScene);
  const { name, setName, joined } = session;
  useGameShortcuts(joined, hud, setMaterial);
  const openConsole = (initialTab?: 'characters') => {
    releasePointerLock();
    setActivePanel(null);
    setConsoleEntry({ initialTab });
  };
  const joinWorld = () => {
    if (connection.status !== 'connected') setActivePanel(null);
    return session.joinWorld();
  };
  const leaveWorld = () => {
    session.leaveWorld();
    setActivePanel(null);
    hud.setChatExpanded(false);
    hud.setVoiceExpanded(false);
  };
  return (
    <GameHUDLayout
      joined={joined}
      shortChat={narrow && shortViewport && chatExpanded}
      ref={mainRef}
      data-game-overlay={activePanel || undefined}
      onPointerDownCapture={(event) => {
        if ((event.target as HTMLElement).closest('[data-hud], #world-panel'))
          releasePointerLock();
      }}
    >
      <div className="world" ref={hostRef} />

      <GameHeader
        connectionStatus={connection.status}
        joined={joined}
        isConsoleOpen={consoleEntry !== null}
        isPlayersOpen={activePanel === 'players'}
        onOpenConsole={() => openConsole()}
        onTogglePlayers={() => togglePanel('players')}
        isMenuOpen={activePanel === 'menu'}
        onToggleMenu={() => togglePanel('menu')}
      />

      {joined && <GameMenu hud={hud} leaveWorld={leaveWorld} />}
      <LobbyLayout>
        {!joined && (
          <LobbyCard
            name={name}
            onNameChange={(value) => {
              connection.joinError = '';
              setName(value);
            }}
            error={connection.joinError}
            onJoin={() => void joinWorld()}
            onCreateAgent={() => openConsole('characters')}
          />
        )}
        <WorldPanel
          connection={connection}
          hidden={joined && activePanel !== 'players'}
          onClose={joined ? () => setActivePanel(null) : undefined}
        />
      </LobbyLayout>

      {joined && (
        <>
          <div className="crosshair">+</div>
          {target && (
            <div className="target">
              {MATERIAL_LABELS[target.material]}
              {showCoordinates && ` · ${target.x}, ${target.y}, ${target.z}`}
            </div>
          )}
        </>
      )}

      <ControlConsole
        connection={connection}
        open={consoleEntry !== null}
        initialTab={consoleEntry?.initialTab}
        onClose={() => setConsoleEntry(null)}
      />

      {joined && (
        <div
          className={`game-communication${chatExpanded || voiceExpanded ? ' has-expanded' : ''}`}
        >
          <SpatialVoicePanel
            connection={connection}
            expanded={voiceExpanded}
            onExpandedChange={changeVoice}
            expandDisabled={narrow && chatBusy}
          />
          <ChatPanel
            connection={connection}
            expanded={chatExpanded}
            onExpandedChange={changeChat}
            onBusyChange={setChatBusy}
          />
        </div>
      )}

      {joined && (
        <GameFooter
          material={material}
          isConnected={connection.status === 'connected'}
          onSelectMaterial={setMaterial}
          onEditBlock={editBlock}
        />
      )}
    </GameHUDLayout>
  );
}

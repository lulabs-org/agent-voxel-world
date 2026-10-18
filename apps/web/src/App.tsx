import { useEffect, useRef, useState } from 'react';
import type { Connection } from './network/connection';
import { WorldPanel } from './features/world/WorldPanel';
import { LobbyCard } from './features/world/LobbyCard';
import { useWorldScene } from './features/world/useWorldScene';
import { ControlConsole } from './features/console/ControlConsole';
import { ChatPanel } from './features/chat/ChatPanel';
import { SpatialVoicePanel } from './features/voice/SpatialVoicePanel';
import { GameHeader } from './features/hud/GameHeader';
import { GameFooter } from './features/hud/GameFooter';
import { ControlsHelp } from './features/hud/ControlsHelp';
import {
  hudShortcut,
  isInteractiveTarget,
  MATERIAL_LABELS,
} from './features/hud/hud-input';
import { releasePointerLock } from './utils/pointer-lock';

const savedName = sessionStorage.getItem('voxel-name');

export function App({ connection }: { connection: Connection }) {
  const [, render] = useState(0);
  const [activePanel, setActivePanel] = useState<
    'players' | 'menu' | 'help' | null
  >(null);
  const [consoleEntry, setConsoleEntry] = useState<{
    initialTab?: 'agents';
  } | null>(null);
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [voiceExpanded, setVoiceExpanded] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [narrow, setNarrow] = useState(
    () => matchMedia('(max-width: 899px)').matches,
  );
  const [shortViewport, setShortViewport] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const query = matchMedia('(max-width: 899px)');
    const update = () => setNarrow(query.matches);
    query.addEventListener('change', update);
    const viewport = window.visualViewport;
    const resize = () => {
      setShortViewport((viewport?.height ?? innerHeight) < 560);
      mainRef.current?.style.setProperty(
        '--hud-height',
        `${viewport?.height ?? innerHeight}px`,
      );
      mainRef.current?.style.setProperty(
        '--hud-top',
        `${viewport?.offsetTop ?? 0}px`,
      );
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    return () => {
      query.removeEventListener('change', update);
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
    };
  }, []);
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
  const [name, setName] = useState(savedName ?? 'Explorer');
  const [joined, setJoined] = useState(!!savedName);

  const { hostRef, target, material, setMaterial, editBlock, leaveWorldScene } =
    useWorldScene(connection);

  useEffect(() => {
    connection.onChange = () => {
      if (connection.joinError) setJoined(false);
      render((n) => n + 1);
    };
    if (savedName) void connection.connect(savedName);
    return () => {
      connection.onChange = () => {};
    };
  }, [connection]);

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

  const openConsole = (initialTab?: 'agents') => {
    releasePointerLock();
    setActivePanel(null);
    setConsoleEntry({ initialTab });
  };

  const joinWorld = async () => {
    if (connection.status === 'connected') return true;
    const explorerName = name.trim() || 'Explorer';
    setName(explorerName);
    setActivePanel(null);
    setJoined(true);
    sessionStorage.setItem('voxel-name', explorerName);
    await connection.connect(explorerName);
    return connection.status === 'connected';
  };

  const leaveWorld = () => {
    leaveWorldScene();
    connection.leave();
    setJoined(false);
    setActivePanel(null);
    setChatExpanded(false);
    setVoiceExpanded(false);
  };

  return (
    <main
      ref={mainRef}
      data-game-overlay={activePanel || undefined}
      className={
        joined
          ? `in-game${narrow && shortViewport && chatExpanded ? ' hud-short-chat' : ''}`
          : 'in-lobby'
      }
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

      {joined && activePanel === 'menu' && (
        <section
          id="game-menu"
          className="hud-popover game-menu"
          aria-label="游戏菜单"
          data-hud
        >
          <button onClick={() => togglePanel('help')}>操作帮助</button>
          <label>
            <input
              type="checkbox"
              checked={showCoordinates}
              onChange={(event) => setShowCoordinates(event.target.checked)}
            />
            显示目标坐标
          </label>
          <button onClick={leaveWorld}>退出游戏</button>
        </section>
      )}
      {joined && activePanel === 'help' && (
        <div className="hud-help" data-hud>
          <ControlsHelp onClose={() => setActivePanel(null)} />
        </div>
      )}
      <div className="lobby-layout">
        {!joined && (
          <LobbyCard
            name={name}
            onNameChange={(value) => {
              connection.joinError = '';
              setName(value);
            }}
            error={connection.joinError}
            onJoin={joinWorld}
            onCreateAgent={() => openConsole('agents')}
          />
        )}
        <WorldPanel
          connection={connection}
          hidden={joined && activePanel !== 'players'}
          onClose={joined ? () => setActivePanel(null) : undefined}
        />
      </div>

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
    </main>
  );
}

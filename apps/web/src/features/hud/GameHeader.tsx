interface GameHeaderProps {
  connectionStatus: string;
  joined: boolean;
  isConsoleOpen: boolean;
  isPlayersOpen: boolean;
  onOpenConsole: () => void;
  onTogglePlayers: () => void;
  isMenuOpen: boolean;
  onToggleMenu: () => void;
}

export function GameHeader({
  connectionStatus,
  joined,
  isConsoleOpen,
  isPlayersOpen,
  onOpenConsole,
  onTogglePlayers,
  isMenuOpen,
  onToggleMenu,
}: GameHeaderProps) {
  const isConnected = connectionStatus === 'connected';

  if (joined) {
    const status = isConnected
      ? '已连接'
      : connectionStatus === 'connecting'
        ? '正在连接…'
        : '连接中断，正在恢复';
    return (
      <header className="game-header" data-hud>
        <div
          className="world-identity"
          tabIndex={0}
          title={status}
          aria-label={`WORLD 01 · ${status}`}
        >
          <i
            className={isConnected ? 'online' : 'offline'}
            aria-hidden="true"
          />
          <strong>WORLD 01</strong>
          {!isConnected && <span role="status">{status}</span>}
        </div>
        <nav className="hud-navigation" aria-label="游戏功能">
          <button
            aria-expanded={isPlayersOpen}
            aria-controls="world-panel"
            onClick={onTogglePlayers}
          >
            玩家
          </button>
          <button
            aria-haspopup="dialog"
            aria-expanded={isConsoleOpen}
            aria-controls="control-console"
            onClick={onOpenConsole}
          >
            控制台
          </button>
          <button
            aria-expanded={isMenuOpen}
            aria-controls="game-menu"
            onClick={onToggleMenu}
          >
            菜单
          </button>
        </nav>
      </header>
    );
  }
  return (
    <header>
      <div className="brand">
        <span className="brand-icon">◈</span>
        <div>
          <strong>EMBOCRAFT</strong>
          <small>A shared world for people & embodied agents</small>
        </div>
      </div>
      <div className="status">
        <i className={isConnected ? 'online' : ''} />
        {joined ? connectionStatus : '游戏大厅'} <span>WORLD 01</span>
        <button
          className="exit-game"
          aria-haspopup="dialog"
          aria-expanded={isConsoleOpen}
          aria-controls="control-console"
          onClick={onOpenConsole}
        >
          控制台
        </button>
        {joined && (
          <nav className="game-panels" aria-label="游戏面板">
            <button
              aria-expanded={isPlayersOpen}
              aria-controls="world-panel"
              onClick={onTogglePlayers}
            >
              玩家
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}

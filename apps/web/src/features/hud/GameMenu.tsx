import { ControlsHelp } from './ControlsHelp';
import type { HudController } from './hooks/useHudController';
export function GameMenu({
  hud,
  leaveWorld,
}: {
  hud: HudController;
  leaveWorld: () => void;
}) {
  const {
    activePanel,
    togglePanel,
    showCoordinates,
    setShowCoordinates,
    setActivePanel,
  } = hud;
  return (
    <>
      {activePanel === 'menu' && (
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
      {activePanel === 'help' && (
        <div className="hud-help" data-hud>
          <ControlsHelp onClose={() => setActivePanel(null)} />
        </div>
      )}
    </>
  );
}

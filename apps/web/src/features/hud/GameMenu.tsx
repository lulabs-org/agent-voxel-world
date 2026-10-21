import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher';
import { useI18n } from '../../i18n';
import { ControlsHelp } from './ControlsHelp';
import type { HudController } from './hooks/useHudController';

export function GameMenu({
  hud,
  leaveWorld,
}: {
  hud: HudController;
  leaveWorld: () => void;
}) {
  const { t } = useI18n();
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
          aria-label={t('hud.menuTitle')}
          data-hud
        >
          <button onClick={() => togglePanel('help')}>
            {t('hud.controlsHelp')}
          </button>
          <label>
            <input
              type="checkbox"
              checked={showCoordinates}
              onChange={(event) => setShowCoordinates(event.target.checked)}
            />
            {t('hud.showCoordinates')}
          </label>
          <LanguageSwitcher variant="menu" />
          <button onClick={leaveWorld}>{t('hud.exitGame')}</button>
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


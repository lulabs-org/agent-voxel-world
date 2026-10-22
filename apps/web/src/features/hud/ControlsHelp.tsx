import { useI18n } from '../../i18n';

interface ControlsHelpProps {
  onClose: () => void;
}

export function ControlsHelp({ onClose }: ControlsHelpProps) {
  const { t } = useI18n();

  return (
    <section
      id="controls-help"
      className="controls-help"
      aria-label={t('hud.controlsHelp')}
    >
      <div className="chat-title">
        <strong>{t('hud.controlsHelp')}</strong>
        <button aria-label={t('hud.closeHelp')} onClick={onClose}>
          ×
        </button>
      </div>
      <dl>
        <div>
          <dt>
            <kbd>W A S D</kbd>
          </dt>
          <dd>{t('hud.controls.move')}</dd>
        </div>
        <div>
          <dt>
            <kbd>Space</kbd>
          </dt>
          <dd>{t('hud.controls.jump')}</dd>
        </div>
        <div>
          <dt>{t('hud.controls.clickScreen')}</dt>
          <dd>{t('hud.controls.lockPointer')}</dd>
        </div>
        <div>
          <dt>
            <kbd>Esc</kbd>
          </dt>
          <dd>{t('hud.controls.releaseCursor')}</dd>
        </div>
        <div>
          <dt>{t('hud.controls.mouseAction')}</dt>
          <dd>{t('hud.controls.breakPlaceAction')}</dd>
        </div>
        <div>
          <dt>{t('hud.controls.switchMaterialKey')}</dt>
          <dd>{t('hud.controls.switchMaterialAction')}</dd>
        </div>
        <div>
          <dt>
            <kbd>Enter</kbd>
          </dt>
          <dd>{t('hud.controls.openChat')}</dd>
        </div>
        <div>
          <dt>{t('voice.title')}</dt>
          <dd>{t('voice.spatialHelp')}</dd>
        </div>
      </dl>
      <p>{t('hud.controls.rangeHint')}</p>
      <p>{t('voice.whisperHint')}</p>
    </section>
  );
}


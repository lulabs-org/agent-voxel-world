import type { Material } from '@voxel/shared';
import { useI18n } from '../../i18n';
import { MATERIALS, MATERIAL_LABELS } from './hud-input';

interface GameFooterProps {
  material: Material;
  isConnected: boolean;
  onSelectMaterial: (m: Material) => void;
  onEditBlock: (place: boolean) => void;
}

export function GameFooter({
  material,
  isConnected,
  onSelectMaterial,
  onEditBlock,
}: GameFooterProps) {
  const { t } = useI18n();
  const getMaterialLabel = (m: Material) =>
    t(`hud.materials.${m}`) || MATERIAL_LABELS[m];

  return (
    <footer className="game-footer" data-hud>
      <span className="material-name" aria-live="polite">
        {getMaterialLabel(material)}
      </span>
      <div className="hotbar" role="group" aria-label={t('hud.blockMaterials')}>
        {MATERIALS.map((m, i) => {
          const label = getMaterialLabel(m);
          return (
            <button
              key={m}
              aria-label={`${i + 1} ${label}`}
              title={`${i + 1} · ${label}`}
              aria-pressed={material === m}
              onClick={() => onSelectMaterial(m)}
            >
              <span className={`swatch ${m}`} />
              <small>{i + 1}</small>
            </button>
          );
        })}
      </div>
      <small className="build-hint">{t('hud.buildHint')}</small>
      <div className="build-actions">
        <button disabled={!isConnected} onClick={() => onEditBlock(false)}>
          {t('hud.breakBlock')}
        </button>
        <button disabled={!isConnected} onClick={() => onEditBlock(true)}>
          {t('hud.placeBlock')}
        </button>
      </div>
    </footer>
  );
}


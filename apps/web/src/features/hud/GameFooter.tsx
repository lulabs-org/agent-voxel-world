import type { Material } from '@voxel/shared';
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
  return (
    <footer className="game-footer" data-hud>
      <span className="material-name" aria-live="polite">
        {MATERIAL_LABELS[material]}
      </span>
      <div className="hotbar" role="group" aria-label="方块材料">
        {MATERIALS.map((m, i) => (
          <button
            key={m}
            aria-label={`${i + 1} ${MATERIAL_LABELS[m]}`}
            title={`${i + 1} · ${MATERIAL_LABELS[m]}`}
            aria-pressed={material === m}
            onClick={() => onSelectMaterial(m)}
          >
            <span className={`swatch ${m}`} />
            <small>{i + 1}</small>
          </button>
        ))}
      </div>
      <small className="build-hint">左键拆除 · 右键放置</small>
      <div className="build-actions">
        <button disabled={!isConnected} onClick={() => onEditBlock(false)}>
          拆除
        </button>
        <button disabled={!isConnected} onClick={() => onEditBlock(true)}>
          放置
        </button>
      </div>
    </footer>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { Material } from '@voxel/shared';
import type { Connection } from '../../network/connection';
import { WorldScene, type TargetBlock } from '../../graphics/scene';

export function useWorldScene(connection: Connection) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const [target, setTarget] = useState<TargetBlock | null>(null);
  const [material, setMaterialState] = useState<Material>('wood');

  useEffect(() => {
    if (!hostRef.current) return;
    const world = new WorldScene(hostRef.current, connection);
    sceneRef.current = world;
    connection.onBlocks = world.rebuild;
    world.onTarget = (next) =>
      setTarget((previous) =>
        previous?.material === next?.material &&
        previous?.x === next?.x &&
        previous?.y === next?.y &&
        previous?.z === next?.z
          ? previous
          : next,
      );

    return () => {
      world.dispose();
      sceneRef.current = null;
    };
  }, [connection]);

  const setMaterial = (m: Material) => {
    setMaterialState(m);
    if (sceneRef.current) {
      sceneRef.current.material = m;
    }
  };

  const editBlock = (place: boolean) => {
    sceneRef.current?.edit(place);
  };

  const leaveWorldScene = () => {
    sceneRef.current?.leaveWorld();
  };

  return {
    hostRef,
    sceneRef,
    target,
    material,
    setMaterial,
    editBlock,
    leaveWorldScene,
  };
}

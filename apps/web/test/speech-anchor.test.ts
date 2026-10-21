import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { projectSpeechAnchor } from '../src/graphics/speech-anchor';

function setup() {
  const camera = new THREE.PerspectiveCamera(70, 1000 / 800, 0.1, 150);
  camera.position.set(0, 1.5, 0);
  camera.updateMatrixWorld();
  return { camera, position: new THREE.Vector3(0, 0, -5) };
}
describe('speech anchor visibility', () => {
  it('follows the speaker in screen space', () => {
    const { camera, position } = setup();
    const anchor = projectSpeechAnchor(camera, position, 1000, 800, []);
    expect(anchor?.x).toBe(500);
    expect(anchor?.y).toBeLessThan(400);
    position.x = 1;
    expect(
      projectSpeechAnchor(camera, position, 1000, 800, [])!.x,
    ).toBeGreaterThan(500);
  });
  it.each([
    [0, 0, 5],
    [20, 0, -5],
    [0, 20, -5],
    [0, 0, -200],
  ])(
    'rejects behind-camera, off-screen and clipped speakers (%j)',
    (x, y, z) => {
      const { camera } = setup();
      expect(
        projectSpeechAnchor(camera, new THREE.Vector3(x, y, z), 1000, 800, []),
      ).toBeNull();
    },
  );
  it('falls back for terrain between camera and head, but not terrain behind the speaker', () => {
    const { camera, position } = setup();
    const wall = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2, 3, 1),
      new THREE.MeshBasicMaterial(),
      1,
    );
    wall.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 1.5, -2));
    wall.computeBoundingSphere();
    wall.updateMatrixWorld();
    expect(projectSpeechAnchor(camera, position, 1000, 800, [wall])).toBeNull();
    wall.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 1.5, -8));
    wall.computeBoundingSphere();
    expect(
      projectSpeechAnchor(camera, position, 1000, 800, [wall]),
    ).not.toBeNull();
    wall.geometry.dispose();
    (wall.material as THREE.Material).dispose();
  });
});

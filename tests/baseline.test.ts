import { test, expect } from 'vitest';
import { WORLD_ID, PROTOCOL_VERSION } from '@voxel/shared';
test('protocol baseline', () => {
  expect(WORLD_ID).toBe('meadow');
  expect(PROTOCOL_VERSION).toBe(1);
});

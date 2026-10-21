import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readManagementArchive,
  writeManagementArchive,
} from '../apps/server/src/persistence/archive-file';
import type { ManagementArchive } from '../apps/server/src/persistence/archive';

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, rename: vi.fn(fs.rename) };
});

it('keeps the previous complete archive on rename failure, cleans the temporary file, and allows a later save', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'joint-archive-'));
  const path = join(directory, 'providers.json.agents.json');
  const before: ManagementArchive = {
    version: 3,
    characters: [],
    plans: [],
    runs: [],
    requests: { previous: 'committed' },
  };
  const after: ManagementArchive = {
    ...before,
    requests: { next: 'committed' },
  };
  try {
    await writeManagementArchive(path, before);
    const original = await readFile(path, 'utf8');
    vi.mocked(rename).mockRejectedValueOnce(new Error('rename failed'));
    await expect(writeManagementArchive(path, after)).rejects.toThrow(
      'rename failed',
    );
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(await readManagementArchive(path)).toEqual(before);
    expect(await readdir(directory)).toEqual(['providers.json.agents.json']);
    await writeManagementArchive(path, after);
    expect(await readManagementArchive(path)).toEqual(after);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(['providers.json.agents.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

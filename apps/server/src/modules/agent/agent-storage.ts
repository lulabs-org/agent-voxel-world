import { readFile, rename, writeFile } from 'node:fs/promises';
import { AppError } from '../../common/errors';
import type { RestoredAgentRecord, GatewayArchive } from './ports';
import { migrateArchive } from './archive';
export async function writeAgentArchive(
  archivePath: string,
  records: GatewayArchive,
): Promise<void> {
  const data = JSON.stringify(records, null, 2);
  const temp = `${archivePath}.tmp`;
  await writeFile(temp, data, { mode: 0o600 });
  await rename(temp, archivePath);
}

export async function readAgentArchive(
  archivePath: string,
): Promise<GatewayArchive | undefined> {
  let saved: RestoredAgentRecord[] | GatewayArchive;
  try {
    saved = JSON.parse(await readFile(archivePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw new AppError('无法读取 Agent 记录。', 500);
  }
  if (!Array.isArray(saved)) return migrateArchive(saved);
  await writeFile(
    `${archivePath}.before-task-plan-module-v1.bak`,
    await readFile(archivePath),
    { mode: 0o600, flag: 'wx' },
  ).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  await writeFile(
    `${archivePath}.before-agent-gateway-v1.bak`,
    await readFile(archivePath),
    { mode: 0o600, flag: 'wx' },
  ).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });

  if (!Array.isArray(saved) || saved.length > 50)
    throw new AppError('Agent 记录格式无效。', 500);

  await writeFile(`${archivePath}.before-pi.bak`, await readFile(archivePath), {
    mode: 0o600,
    flag: 'wx',
  }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });

  if (
    saved.some(
      (view) =>
        view.runtime?.version !== 2 ||
        view.taskBook?.runs.some(
          (run) => run.runtime && run.runtime.version !== 2,
        ),
    )
  ) {
    await writeFile(
      `${archivePath}.before-conversation-tasks-v2.bak`,
      await readFile(archivePath),
      {
        mode: 0o600,
        flag: 'wx',
      },
    ).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }

  if (saved.some((view) => !view.taskBook)) {
    await writeFile(
      `${archivePath}.before-task-plans.bak`,
      await readFile(archivePath),
      { mode: 0o600, flag: 'wx' },
    ).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }

  return migrateArchive(saved);
}

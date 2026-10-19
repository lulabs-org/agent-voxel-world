import { readFile, rename, writeFile } from 'node:fs/promises';
import {
  ManagementError,
  type RestoredAgentRecord,
} from '@voxel/agent-gateway';
export async function writeAgentArchive(
  archivePath: string,
  records: RestoredAgentRecord[],
): Promise<void> {
  const data = JSON.stringify(records, null, 2);
  const temp = `${archivePath}.tmp`;
  await writeFile(temp, data, { mode: 0o600 });
  await rename(temp, archivePath);
}

export async function readAgentArchive(
  archivePath: string,
): Promise<RestoredAgentRecord[] | undefined> {
  let saved: RestoredAgentRecord[];
  try {
    saved = JSON.parse(await readFile(archivePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw new ManagementError('无法读取 Agent 记录。', 500);
  }
  await writeFile(
    `${archivePath}.before-agent-gateway-v1.bak`,
    await readFile(archivePath),
    { mode: 0o600, flag: 'wx' },
  ).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });

  if (!Array.isArray(saved) || saved.length > 50)
    throw new ManagementError('Agent 记录格式无效。', 500);

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

  return saved;
}

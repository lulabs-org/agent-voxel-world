import { readFile, rename, writeFile } from 'node:fs/promises';
import { isRepeating, DEFAULT_TASK_LIMITS } from '@voxel/shared';
import { AppError } from '../../common/errors';
import type {
  RestoredAICharacterRecord,
  AICharacterArchive,
  LegacyAgentArchive,
} from './ports';
import { newPlan, newRun } from '../tasks';

export async function writeAICharacterArchive(
  archivePath: string,
  records: AICharacterArchive,
): Promise<void> {
  const data = JSON.stringify(records, null, 2);
  const temp = `${archivePath}.tmp`;
  await writeFile(temp, data, { mode: 0o600 });
  await rename(temp, archivePath);
}

export async function readAICharacterArchive(
  archivePath: string,
): Promise<AICharacterArchive | undefined> {
  let saved:
    | RestoredAICharacterRecord[]
    | LegacyAgentArchive
    | AICharacterArchive;
  try {
    saved = JSON.parse(await readFile(archivePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw new AppError('无法读取 Agent 记录。', 500);
  }
  const migrated = migrateArchive(saved);
  if (Array.isArray(saved) || saved.version === 1) {
    await writeFile(
      `${archivePath}.before-ai-characters-v2.bak`,
      await readFile(archivePath),
      { mode: 0o600, flag: 'wx' },
    ).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  if (!Array.isArray(saved)) return migrated;

  if (saved.length > 50) {
    throw new AppError('Agent 记录格式无效。', 500);
  }

  await createHistoricalBackups(archivePath, saved);
  return migrated;
}

/** Pure, repeatable migration; disk backup and atomic replacement belong to the host. */
export function migrateArchive(
  saved: RestoredAICharacterRecord[] | LegacyAgentArchive | AICharacterArchive,
): AICharacterArchive {
  if (!Array.isArray(saved)) {
    if (
      !saved ||
      ![1, 2].includes(saved.version) ||
      !Array.isArray(saved.version === 1 ? saved.agents : saved.characters) ||
      !Array.isArray(saved.plans) ||
      !Array.isArray(saved.runs) ||
      !saved.requests ||
      typeof saved.requests !== 'object'
    )
      throw new AppError('网关存档格式无效。', 500);
    const copy: AICharacterArchive =
      saved.version === 1
        ? {
            version: 2,
            characters: structuredClone(saved.agents),
            plans: saved.plans.map((plan) => {
              const converted = migrateBinding(plan);
              if (converted.latestRun)
                converted.latestRun = migrateBinding(converted.latestRun);
              return converted;
            }),
            runs: saved.runs.map(migrateBinding),
            requests: structuredClone(saved.requests),
          }
        : structuredClone(saved);
    validateArchive(copy);
    return copy;
  }
  const result: AICharacterArchive = {
    version: 2,
    characters: [],
    plans: [],
    runs: [],
    requests: {},
  };
  for (const original of saved) {
    const a = structuredClone(original),
      book = a.taskBook;
    if (book) {
      if (
        book.version !== 1 ||
        !Array.isArray(book.plans) ||
        !Array.isArray(book.runs)
      )
        throw new AppError('任务存档格式无效。', 500);
      for (const p of book.plans) {
        const runs = book.runs.filter((r) => r.planId === p.id);
        const chatOnly =
          p.timing.kind === 'immediate' &&
          !Object.values(book.requests ?? {}).includes(p.id) &&
          runs.length > 0 &&
          runs.every((r) => r.source === 'chat');
        if (chatOnly) {
          for (const r of runs) delete r.planId;
        } else
          result.plans.push({
            ...migrateBinding(p),
            ...(p.latestRun ? { latestRun: migrateBinding(p.latestRun) } : {}),
            characterId: a.id,
            characterName: a.name,
            revision: p.revision ?? 1,
            imported:
              !isRepeating(p.timing) &&
              !runs.some((r) => ['manual', 'scheduled'].includes(r.source)),
          });
      }
      for (const r of book.runs)
        result.runs.push({
          ...migrateBinding(r),
          characterId: a.id,
          characterName: a.name,
          planRevision: r.planId ? (r.planRevision ?? 1) : undefined,
        });
      for (const [key, id] of Object.entries(book.requests ?? {}))
        result.requests[`${a.id}:${key}`] = id;
      a.currentRunId = book.currentRunId;
    }
    if (!book && (a.runtime?.task || a.task)) {
      const task = a.runtime?.task ?? a.task!;
      const p = {
        ...newPlan(
          {
            name: task.goal.slice(0, 80) || '历史导入',
            goal: task.goal,
            timing: { kind: 'immediate' },
            timeZone: 'UTC',
            limits: { ...DEFAULT_TASK_LIMITS },
            totalTokenBudget: 500000,
          },
          task.startedAt,
        ),
        characterId: a.id,
        characterName: a.name,
        imported: true,
      };
      const r = newRun(p, task.startedAt, 'legacy');
      r.task = structuredClone(task);
      r.runtime = a.runtime
        ? structuredClone(a.runtime)
        : { task: structuredClone(task) };
      r.status = task.status;
      r.totalTokens = task.tokens;
      r.accountedTokens = task.tokens;
      p.spentTokens = task.tokens;
      result.plans.push(p);
      result.runs.push(r);
      a.currentRunId = r.id;
    }
    delete a.taskBook;
    result.characters.push(a);
  }
  validateArchive(result);
  return result;
}

/** Rename only ownership fields; runtime checkpoints and opaque request keys are untouched. */
function migrateBinding<T extends object>(value: T) {
  const { agentId, agentName, ...rest } = structuredClone(value) as T & {
    agentId?: string;
    agentName?: string;
  };
  return {
    ...rest,
    ...(agentId === undefined ? {} : { characterId: agentId }),
    ...(agentName === undefined ? {} : { characterName: agentName }),
  };
}

function validateArchive(s: AICharacterArchive) {
  for (const list of [s.characters, s.plans, s.runs]) {
    const ids = list.map((x) => x.id);
    if (
      ids.some((id) => typeof id !== 'string' || !id) ||
      new Set(ids).size !== ids.length
    )
      throw new AppError('存档资源标识重复或无效。', 500);
  }
  for (const p of s.plans)
    if (p.characterId && !s.characters.some((a) => a.id === p.characterId))
      throw new AppError('计划关联角色不存在。', 500);
  for (const r of s.runs)
    if (r.planId && !s.plans.some((p) => p.id === r.planId))
      throw new AppError('执行关联计划不存在。', 500);
  for (const a of s.characters)
    if (
      a.currentRunId &&
      !s.runs.some((r) => r.id === a.currentRunId && r.characterId === a.id)
    )
      throw new AppError('当前执行关联无效。', 500);
}

/**
 * 历史阶段性升级备份（保持幂等防覆盖）
 */
async function createHistoricalBackups(
  archivePath: string,
  saved: RestoredAICharacterRecord[],
): Promise<void> {
  const content = await readFile(archivePath);
  const safeWrite = async (suffix: string) => {
    await writeFile(`${archivePath}${suffix}`, content, {
      mode: 0o600,
      flag: 'wx',
    }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
  };

  await safeWrite('.before-task-plan-module-v1.bak');
  await safeWrite('.before-agent-gateway-v1.bak');
  await safeWrite('.before-pi.bak');

  if (
    saved.some(
      (view) =>
        view.runtime?.version !== 2 ||
        view.taskBook?.runs.some(
          (run) => run.runtime && run.runtime.version !== 2,
        ),
    )
  ) {
    await safeWrite('.before-conversation-tasks-v2.bak');
  }

  if (saved.some((view) => !view.taskBook)) {
    await safeWrite('.before-task-plans.bak');
  }
}

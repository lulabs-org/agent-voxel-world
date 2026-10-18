import { readFile, rename, writeFile } from 'node:fs/promises';
import type { AgentSettings, ManagedAgentView } from '@voxel/shared';
import {
  AgentAttention,
  newTask,
  restoreBatchHistory,
  restorePiCheckpoint,
  type AgentRunState,
} from '@voxel/agent-runtime';
import { isRepeating } from '@voxel/shared';
import { restoreAgentLogs } from './agent-logs';
import {
  duePlans,
  emptyTaskBook,
  endedRun,
  newRun,
  nextOccurrence,
  type TaskBook,
} from './task-scheduler';
import { ManagementError, validateAgent } from './validation';
import type { ProviderStore } from './provider-store';
import type { Job } from './types';
import { captureTask } from './task-operations';

export type RestoredAgentRecord = ManagedAgentView & {
  runtime?: AgentRunState;
  taskBook?: TaskBook;
};

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
  if (!Array.isArray(saved) || saved.length > 50)
    throw new ManagementError('Agent 记录格式无效。', 500);

  await writeFile(`${archivePath}.before-pi.bak`, await readFile(archivePath), {
    mode: 0o600,
    flag: 'wx',
  }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });

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

export function restoreAgentJob(
  view: RestoredAgentRecord,
  providers: ProviderStore,
  checkVoice: (settings: AgentSettings) => void,
): { job: Job; voiceWarning?: string; shouldAutoJoin: boolean } {
  const provider = providers.get(view.providerId);
  const settings = validateAgent(view, provider);
  let voiceWarning = '';
  try {
    checkVoice(settings);
  } catch {
    settings.voiceReplies = false;
    settings.voiceServiceId = '';
    voiceWarning = '原语音服务不可用，已保留文字回复；请重新选择语音服务。';
  }
  if (typeof view.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(view.id))
    throw new ManagementError('Agent 标识无效。', 500);

  const job: Job = {
    view: {
      ...settings,
      id: view.id,
      createdAt: view.createdAt,
      providerName: provider.name,
      status: 'stopped',
      ...restoreAgentLogs(view.logs, view.logTimes),
    },
    abort: new AbortController(),
    memory: view.runtime ?? {
      task: view.task ?? {
        ...newTask(settings.goal),
        status: 'paused',
        reason: '旧任务已迁移，请确认后继续。',
      },
    },
    attention: new AgentAttention(),
    book: view.taskBook ?? emptyTaskBook(),
  };

  job.memory.previous = restoreBatchHistory(job.memory.previous);
  restorePiCheckpoint(job.memory);
  if (
    job.memory.task &&
    ['running', 'waiting'].includes(job.memory.task.status)
  ) {
    job.memory.task.status = 'paused';
    job.memory.task.reason = '服务重启，任务进度已保留，请手动继续。';
  }
  if (job.memory.task && !job.memory.task.privateTo)
    delete job.memory.task.owner;
  if (
    job.memory.task?.privateTo &&
    !['completed', 'cancelled'].includes(job.memory.task.status)
  ) {
    job.memory.audienceExpired = true;
    job.memory.task.status = 'needs_input';
    job.memory.task.reason =
      '服务重启后原私聊会话已失效，请在控制台重新布置任务。';
  }
  if (
    job.book.version !== 1 ||
    !Array.isArray(job.book.plans) ||
    !Array.isArray(job.book.runs)
  )
    throw new ManagementError('任务存档格式无效。', 500);

  const interruptedRuns = new Set(
    job.book.runs
      .filter((r) =>
        [
          'running',
          'waiting',
          'failed',
          'budget',
          'blocked',
          'needs_input',
        ].includes(r.status),
      )
      .map((r) => r.id),
  );
  const migrating = !view.taskBook;
  captureTask(job);

  for (const run of job.book.runs) {
    for (const action of run.actions ?? [])
      if (action.status === 'executing') action.status = 'unknown';
    if (run.runtime?.previous)
      run.runtime.previous = restoreBatchHistory(run.runtime.previous);
    if (run.runtime?.task?.privateTo && !endedRun(run)) {
      run.runtime.audienceExpired = true;
      run.runtime.task.status = 'needs_input';
      run.runtime.task.reason = '原私聊会话已失效，请新建任务。';
      run.status = 'needs_input';
      run.task = structuredClone(run.runtime.task);
    }
    if (['running', 'waiting'].includes(run.status)) {
      run.status = 'paused';
      run.reason = '服务重启，进度保留，请手动继续。';
      if (run.runtime?.task) {
        run.runtime.task.status = 'paused';
        run.runtime.task.reason = run.reason;
        run.task = structuredClone(run.runtime.task);
      }
    }
    if (
      !endedRun(run) &&
      (migrating || interruptedRuns.has(run.id) || run.runtime?.audienceExpired)
    ) {
      const p = job.book.plans.find((p) => p.id === run.planId);
      if (p) {
        p.state = 'paused';
        p.reason = '执行尚未结束，请确认后恢复计划。';
        delete p.nextRunAt;
      }
    }
  }

  for (const plan of duePlans(job.book, Date.now())) {
    const run = newRun(plan, plan.nextRunAt!, 'scheduled');
    run.status = isRepeating(plan.timing) ? 'skipped' : 'missed';
    run.reason = '服务未运行，错过的触发不补跑。';
    run.finishedAt = Date.now();
    job.book.runs.push(run);
    plan.nextRunAt = nextOccurrence(plan, Date.now());
    if (!isRepeating(plan.timing)) plan.state = 'completed';
  }

  const shouldAutoJoin = ['idle', 'running', 'joining', 'failed'].includes(
    view.status,
  );

  return { job, voiceWarning: voiceWarning || undefined, shouldAutoJoin };
}

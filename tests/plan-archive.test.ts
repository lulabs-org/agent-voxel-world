import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateArchive } from '../apps/server/src/modules/agent/archive';
import { newPlan, newRun } from '../apps/server/src/modules/tasks';
import { DEFAULT_TASK_LIMITS } from '../packages/shared/src/index';
import {
  readAgentArchive,
  writeAgentArchive,
} from '../apps/server/src/modules/agent/agent-storage';

const draft = {
  name: '巡查',
  goal: '观察',
  timing: { kind: 'immediate' as const },
  timeZone: 'UTC',
  limits: DEFAULT_TASK_LIMITS,
  totalTokenBudget: 500000,
};
it('migrates pure chat independently, preserves mixed/manual plans, IDs, request scopes and budgets', () => {
  const chat = newPlan(draft, 100),
    mixed = newPlan(draft, 100),
    legacy = newPlan(draft, 100);
  chat.spentTokens = 12;
  mixed.spentTokens = 30;
  const c = newRun(chat, 100, 'chat'),
    m = newRun(mixed, 101, 'manual'),
    mc = newRun(mixed, 102, 'chat');
  const records: any[] = [
    {
      id: 'a',
      name: 'A',
      taskBook: {
        version: 1,
        plans: [chat, mixed, legacy],
        runs: [c, m, mc],
        currentRunId: c.id,
        requests: { same: mixed.id },
      },
    },
    {
      id: 'b',
      name: 'B',
      taskBook: {
        version: 1,
        plans: [],
        runs: [],
        requests: { same: legacy.id },
      },
    },
  ];
  const result = migrateArchive(records);
  expect(result.plans.map((p) => p.id)).toEqual([mixed.id, legacy.id]);
  expect(result.plans[0]).toMatchObject({
    agentId: 'a',
    revision: 1,
    spentTokens: 30,
  });
  expect(result.plans[1].imported).toBe(true);
  expect(result.runs.find((r) => r.id === c.id)).toMatchObject({
    agentId: 'a',
    source: 'chat',
  });
  expect(result.runs.find((r) => r.id === c.id)?.planId).toBeUndefined();
  expect(result.runs.find((r) => r.id === mc.id)?.planId).toBe(mixed.id);
  expect(result.agents[0]).toMatchObject({ currentRunId: c.id });
  expect(result.agents[0].taskBook).toBeUndefined();
  expect(result.requests).toEqual({ 'a:same': mixed.id, 'b:same': legacy.id });
  expect(migrateArchive(result)).toEqual(result);
  expect(records[0].taskBook.plans).toHaveLength(3);
});
it('backs up the old archive once and atomically writes the independent envelope', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plans-upgrade-'));
  const path = join(dir, 'agents.json');
  try {
    const old = JSON.stringify([{ id: 'a', name: 'A' }]);
    await writeFile(path, old);
    const archive = await readAgentArchive(path);
    expect(
      await readFile(path + '.before-task-plan-module-v1.bak', 'utf8'),
    ).toBe(old);
    await writeAgentArchive(path, archive!);
    expect(await readAgentArchive(path)).toEqual(archive);
    expect(
      await readFile(path + '.before-task-plan-module-v1.bak', 'utf8'),
    ).toBe(old);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('rejects duplicate identities, dangling current runs and unsupported envelopes before execution', () => {
  expect(() => migrateArchive([{ id: 'same' }, { id: 'same' }] as any)).toThrow(
    '标识',
  );
  expect(() =>
    migrateArchive({
      version: 2,
      agents: [],
      plans: [],
      runs: [],
      requests: {},
    } as any),
  ).toThrow('格式');
  expect(() =>
    migrateArchive({
      version: 1,
      agents: [{ id: 'a', currentRunId: 'missing' }],
      plans: [],
      runs: [],
      requests: {},
    } as any),
  ).toThrow('当前执行');
});

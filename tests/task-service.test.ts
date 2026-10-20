import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  newTask,
  TaskService,
  restorePiCheckpoint,
  type AgentRunState,
} from '@voxel/agent-runtime';
import { agentConfig } from '../apps/agent-cli/src/cli/agent-config';
import { RequestBudget } from '../packages/agent-runtime/src/task/budget';
import { readAgentArchive } from '../apps/server/src/modules/agent';
import { ProviderStore } from '../apps/server/src/modules/providers/provider-store';
const config = agentConfig({ DEEPSEEK_API_KEY: 'fixture' });
const operator = { kind: 'operator' as const };

describe('TaskService revision and commit boundary', () => {
  it('retains identity, costs and unknown effects when revising, but invalidates old results', () => {
    const memory: AgentRunState = {
      task: newTask('old'),
      usage: { calls: 2, tokens: 400, estimated: false },
      unknownEffect: { id: 'effect', name: 'chat', state: 'unknown' },
    };
    Object.assign(memory.task!, { calls: 2, tokens: 400, elapsedMs: 500 });
    const service = new TaskService(memory),
      lease = service.lease();
    memory.follow = {
      action: { type: 'follow', playerId: 'human', distance: 1 },
      taskStartedAt: memory.task!.startedAt,
      pursuing: true,
    };
    service.command({ type: 'revise', goal: 'new' }, operator, config);
    expect(service.lease()).toMatchObject({
      id: lease.id,
      revision: lease.revision + 1,
    });
    expect(memory.task).toMatchObject({
      goal: 'new',
      calls: 2,
      tokens: 400,
      elapsedMs: 500,
    });
    expect(memory.follow).toBeUndefined();
    expect(memory.unknownEffect).toBeDefined();
    expect(() =>
      service.finish(lease, { status: 'completed', reason: 'late' }),
    ).toThrow('过期');
  });
  it('rolls back a rejected durable command without losing provider usage', async () => {
    const memory: AgentRunState = {
      task: newTask('old'),
      usage: { calls: 0, tokens: 0, estimated: false },
    };
    const before = structuredClone(memory.task);
    const budget = new RequestBudget(config, memory.usage!);
    budget.begin();
    budget.finish(100, false);
    await expect(
      new TaskService(memory).commit(
        { type: 'revise', goal: 'new' },
        operator,
        config,
        async () => {
          throw Error('disk');
        },
        budget,
      ),
    ).rejects.toThrow('检查点');
    expect(memory.task).toEqual(before);
    expect(memory.usage).toMatchObject({ calls: 1, tokens: 100 });
  });
  it('checks a completion independently of model prose', () => {
    const memory: AgentRunState = { task: newTask('work') };
    const service = new TaskService(memory),
      lease = service.lease();
    expect(() =>
      service.finish(lease, { status: 'completed', reason: 'done' }, true),
    ).toThrow('未确认');
    memory.unknownEffect = { id: 'unknown', name: 'goto', state: 'unknown' };
    expect(() =>
      service.finish(lease, { status: 'completed', reason: 'done' }),
    ).toThrow('未确认');
  });
});

it('backs up and migrates current and historical runtimes while preserving uncertain effects and budgets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-v2-migration-'));
  try {
    const providers = new ProviderStore(join(dir, 'providers.json'));
    await providers.load({ DEEPSEEK_API_KEY: 'fixture' });
    const task = { ...newTask('old build'), calls: 3, tokens: 600 };
    const runtime: AgentRunState = {
      task,
      pi: {
        version: 1,
        taskStartedAt: task.startedAt,
        audience: 'public',
        messages: [],
        inFlight: { id: 'old-chat', name: 'chat', state: 'executing' },
      },
    };
    const record = {
      ...config,
      providerId: 'deepseek',
      id: 'old-agent',
      status: 'stopped',
      createdAt: task.startedAt,
      logs: [],
      runtime,
      taskBook: {
        version: 1,
        plans: [
          {
            id: 'old-plan',
            name: 'old build',
            goal: 'old build',
            timing: { kind: 'immediate' },
            state: 'completed',
            revision: 1,
            spentTokens: 600,
            limits: {},
            totalTokenBudget: 500000,
          },
        ],
        runs: [
          {
            id: 'old-run',
            planId: 'old-plan',
            status: 'completed',
            runtime: structuredClone(runtime),
            snapshot: { limits: {}, timing: { kind: 'immediate' } },
            accountedTokens: 600,
            totalTokens: 600,
            logs: [],
          },
        ],
      },
    };
    // Keep the current run ended to avoid fabricating another plan during restore.
    record.runtime.task!.status = 'completed';
    const path = join(dir, 'archive.json');
    const original = JSON.stringify([record]);
    await writeFile(path, original);
    const saved = await readAgentArchive(path);
    expect(
      await readFile(`${path}.before-conversation-tasks-v2.bak`, 'utf8'),
    ).toBe(original);
    // The archive reader is deliberately lossless; migration belongs to restoration.
    const migrated = saved!.agents[0];
    restorePiCheckpoint(migrated.runtime!);
    for (const run of saved!.runs) restorePiCheckpoint(run.runtime!);
    expect(migrated.runtime).toMatchObject({
      version: 2,
      task: { calls: 3, tokens: 600 },
      unknownEffect: { name: 'chat', state: 'unknown' },
    });
    expect(migrated.runtime!.pi).toBeUndefined();
    expect(saved!.runs[0].runtime).toMatchObject({
      version: 2,
      unknownEffect: { name: 'chat' },
    });
    const again = structuredClone(migrated.runtime);
    restorePiCheckpoint(again!);
    expect(again).toEqual(migrated.runtime);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

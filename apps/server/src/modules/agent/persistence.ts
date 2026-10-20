import type { ManagedAgentView } from '@voxel/shared';
import { AppError } from '../../common/errors';
import type { ArchivePort, RestoredAgentRecord, AgentArchive } from './ports';
import type { AgentEvents } from './events';
import type { AgentRegistry } from './types';
import type { AgentWakeScheduler } from './wake-scheduler';
import type { PlanService } from '../tasks';
import { captureTask } from './task-execution';

export class AgentPersistence {
  private saving: Promise<void> = Promise.resolve();
  private committed = new Map<string, RestoredAgentRecord>();
  private committedViews: ManagedAgentView[] = [];
  storageRevision = 0;
  planStorageFailed = false;

  constructor(
    private readonly archive: ArchivePort,
    private readonly events: AgentEvents,
  ) {}

  assertWritable(closing: boolean, jobStorageFailed?: boolean) {
    if (closing) throw new AppError('世界服务正在关闭。', 503);
    if (jobStorageFailed)
      throw new AppError(
        '存档失败，已停止此 Agent 的后续动作。请修复存储后重启服务。',
        503,
      );
  }

  publicList(): ManagedAgentView[] {
    return structuredClone(this.committedViews);
  }

  publicIdentity(id: string) {
    return structuredClone(this.committed.get(id)?.runtime?.identity);
  }

  committedAgentName(id: string): string | undefined {
    return this.committed.get(id)?.name;
  }

  getCommittedRecord(id: string): RestoredAgentRecord | undefined {
    return this.committed.get(id);
  }

  initCommitted(records: RestoredAgentRecord[], views: ManagedAgentView[]) {
    this.committed = new Map(records.map((record) => [record.id, record]));
    this.committedViews = views;
  }

  async flush(since = this.storageRevision): Promise<void> {
    await this.saving;
    if (since !== this.storageRevision)
      throw new AppError('保存失败，操作结果待确认，请检查存储。', 503);
  }

  persist(
    jobs: AgentRegistry,
    plans: PlanService,
    committedPlans: PlanService,
    taskScheduler: AgentWakeScheduler,
    listFn: () => ManagedAgentView[],
    shutdownPresence: Map<string, ManagedAgentView['status']>,
  ): Promise<void> {
    for (const job of jobs.values()) captureTask(job);
    const views = listFn();
    const records = [...views].reverse().map((view) => ({
      ...view,
      status: shutdownPresence.get(view.id) ?? view.status,
      sessionId: undefined,
      runtime: structuredClone(jobs.get(view.id)?.memory),
      currentRunId: jobs.get(view.id)?.currentRunId,
    }));
    const snapshot: AgentArchive = {
      version: 1,
      agents: records,
      plans: structuredClone(plans.plans),
      runs: structuredClone(plans.runs),
      requests: { ...plans.requests },
    };

    this.saving = this.saving
      .catch(() => {})
      .then(async () => {
        try {
          await this.archive.save(snapshot);
        } catch (error) {
          this.storageRevision++;
          const changedPlans = snapshot.plans.filter(
            (p) =>
              JSON.stringify(p) !==
              JSON.stringify(
                committedPlans.plans.find((old) => old.id === p.id),
              ),
          );
          const changedRuns = snapshot.runs.filter(
            (r) =>
              JSON.stringify(r) !==
              JSON.stringify(
                committedPlans.runs.find((old) => old.id === r.id),
              ),
          );
          if (changedPlans.length || changedRuns.length)
            this.planStorageFailed = true;
          const affected = new Set(
            [...changedPlans, ...changedRuns].map((x) => x.agentId),
          );
          for (const record of records) {
            if (
              !affected.has(record.id) &&
              JSON.stringify(this.committed.get(record.id)) ===
                JSON.stringify(record)
            )
              continue;
            const job = jobs.get(record.id);
            if (job) {
              job.storageFailed = true;
              job.abort.abort();
              taskScheduler.cancel(record.id);
            }
          }
          throw error;
        }
        this.committed = new Map(records.map((record) => [record.id, record]));
        this.committedViews = views;
        Object.assign(committedPlans, {
          plans: snapshot.plans,
          runs: snapshot.runs,
          requests: snapshot.requests,
        });
        this.events.commit(records, snapshot);
      });

    void this.saving.catch(() => console.error('无法保存 Agent 记录。'));
    return this.saving;
  }
}

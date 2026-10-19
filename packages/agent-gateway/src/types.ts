import type { ManagedAgentView } from '@voxel/shared';
import type {
  AgentAttention,
  AgentRunState,
  Session,
} from '@voxel/agent-runtime';
import type { PlanService } from './plans/service';
import type { AgentHost } from './executor';

export type Job = {
  view: ManagedAgentView;
  host?: AgentHost;
  abort: AbortController;
  session?: Session;
  done?: Promise<void>;
  memory: AgentRunState;
  ledger: PlanService;
  currentRunId?: string;
  taskMutating?: boolean;
  attention: AgentAttention;
  updating?: boolean;
  controlling?: boolean;
  storageFailed?: boolean;
};

export const active = (status: ManagedAgentView['status']) =>
  ['joining', 'running', 'stopping'].includes(status);

export const resident = (job: Job) => !!job.session || active(job.view.status);

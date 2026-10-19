import type { ManagedAgentView } from '@voxel/shared';
import type {
  AgentAttention,
  AgentRunState,
  Session,
} from '@voxel/agent-runtime';
import type { PlanService } from '../tasks';
import type { SavedProvider } from '../providers/provider-validation';

export interface HostedAgent {
  run(provider: SavedProvider, run?: boolean): Promise<void>;
}

export type Job = {
  view: ManagedAgentView;
  host?: HostedAgent;
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

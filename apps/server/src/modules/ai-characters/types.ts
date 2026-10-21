import type { AICharacterView } from '@voxel/shared';
import type {
  AgentAttention,
  AgentRunState,
  Session,
} from '@voxel/agent-runtime';
import type { PlanService } from '../tasks/service';
import type { SavedProvider } from '../providers/provider-validation';

export interface HostedAICharacter {
  run(provider: SavedProvider, run?: boolean): Promise<void>;
}

export type Job = {
  view: AICharacterView;
  host?: HostedAICharacter;
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

export const active = (status: AICharacterView['status']) =>
  ['joining', 'running', 'stopping'].includes(status);

export const resident = (job: Job) => !!job.session || active(job.view.status);

/** The sole owner of hosted Agent instances. Never shared with standalone CLI instances. */
export class AICharacterRegistry extends Map<string, Job> {}

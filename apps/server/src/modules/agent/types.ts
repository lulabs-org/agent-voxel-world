import type { ManagedAgentView } from '@voxel/shared';
import type {
  AgentAttention,
  AgentRunState,
  Session,
} from '@voxel/agent-runtime';
import type { TaskBook } from './scheduler';

export type Job = {
  view: ManagedAgentView;
  abort: AbortController;
  session?: Session;
  done?: Promise<void>;
  memory: AgentRunState;
  book: TaskBook;
  taskMutating?: boolean;
  attention: AgentAttention;
  updating?: boolean;
  timer?: ReturnType<typeof setTimeout>;
  controlling?: boolean;
};

export const active = (status: ManagedAgentView['status']) =>
  ['joining', 'running', 'stopping'].includes(status);

export const resident = (job: Job) => !!job.session || active(job.view.status);

import type { AgentRunState } from '@voxel/agent-runtime';
import type { AICharacterSettings, AICharacterView } from '@voxel/shared';
import type { PlanService } from './service';

/** Mutable task state only: no world Session, runner, abort controller or Agent registry. */
export interface TaskExecutionState {
  view: AICharacterSettings & Pick<AICharacterView, 'id' | 'status' | 'logs'>;
  memory: AgentRunState;
  readonly ledger: PlanService;
  currentRunId: string | undefined;
  taskMutating?: boolean;
  readonly updating?: boolean;
  readonly controlling?: boolean;
  readonly storageFailed?: boolean;
  readonly online: boolean;
}

/** Tasks owns policy; the Agent adapter owns runtime effects and serialization with shutdown. */
export interface TaskHostPort {
  execution(id: string): TaskExecutionState;
  findExecution(id: string): TaskExecutionState | undefined;
  executions(): Iterable<TaskExecutionState>;
  save(): Promise<void>;
  schedule(id: string): void;
  launch(id: string): void;
  withStoppedExecution<T>(id: string, change: () => Promise<T>): Promise<T>;
  validateExecution(
    id: string,
    settings: Partial<AICharacterSettings>,
  ): AICharacterSettings;
  storageFailed(): boolean;
  committedName(id: string): string | undefined;
  publicIdentity(id: string): AgentRunState['identity'];
  resourceVersion(): number;
  isClosing(): boolean;
  assertWritable(id?: string): void;
}

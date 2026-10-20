import type { TaskExecutionState } from '../tasks/execution-port';
import type { Job } from './types';

const states = new WeakMap<Job, TaskExecutionState>();

/** Hide transport and runner ownership while keeping task state live across checkpoint restores. */
export function executionState(job: Job): TaskExecutionState {
  const previous = states.get(job);
  if (previous) return previous;
  const state: TaskExecutionState = {
    get view() {
      return job.view;
    },
    set view(value: TaskExecutionState['view']) {
      job.view = {
        createdAt: job.view.createdAt,
        providerName: job.view.providerName,
        ...value,
      };
    },
    get memory() {
      return job.memory;
    },
    set memory(value) {
      job.memory = value;
    },
    get ledger() {
      return job.ledger;
    },
    get currentRunId() {
      return job.currentRunId;
    },
    set currentRunId(value) {
      job.currentRunId = value;
    },
    get taskMutating() {
      return job.taskMutating;
    },
    set taskMutating(value) {
      job.taskMutating = value;
    },
    get updating() {
      return job.updating;
    },
    get controlling() {
      return job.controlling;
    },
    get storageFailed() {
      return job.storageFailed;
    },
    get online() {
      return !!job.session;
    },
  };
  states.set(job, state);
  return state;
}

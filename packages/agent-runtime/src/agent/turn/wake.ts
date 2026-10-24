import type { ModelEndpoint } from '../../contracts/config';
import type { WorldEvent } from '@voxel/shared';
import { BackgroundActionTracker } from '../action/background';
import { runFollowStep } from '../action/follow';
import { checkBudgetCap } from '../task/budget';
import { restoreCheckpoint } from './checkpoint';
import type { RunOptions } from './options';
import { Turn, type TurnActions } from './turn';

/** One wake-up: follow ticks and background actions first, then event decisions. */
export class CharacterRunner {
  constructor(
    private endpoint: ModelEndpoint,
    private request: typeof fetch,
  ) {}

  async run(o: RunOptions) {
    const { memory, signal } = o;
    const background = new BackgroundActionTracker();
    let message = o.attention?.take();
    if (!message) restoreCheckpoint(memory);
    if (
      memory.task.current &&
      ['running', 'waiting'].includes(memory.task.current.status)
    ) {
      const reason = checkBudgetCap(memory.task.current, o.config);
      if (reason) {
        memory.task.current.status = 'budget';
        memory.task.current.reason = reason;
        await o.checkpoint?.();
      }
    }
    let actionResult = false;
    try {
      do {
        if (signal.aborted) break;
        if (
          !message &&
          memory.effects.follow &&
          !actionResult &&
          memory.task.current &&
          ['running', 'waiting'].includes(memory.task.current.status)
        ) {
          const reason = checkBudgetCap(memory.task.current!, o.config);
          if (reason) {
            memory.task.current!.status = 'budget';
            memory.task.current!.reason = reason;
            await o.checkpoint?.();
          } else await runFollowStep(o);
          if (
            memory.task.current?.status === 'blocked' &&
            memory.effects.activeAction?.status === 'failed'
          ) {
            delete memory.effects.follow;
            memory.task.current.status = 'running';
            actionResult = true;
          } else return;
        }
        if (
          !message &&
          !actionResult &&
          (!memory.task.current ||
            !['running', 'waiting'].includes(memory.task.current.status))
        )
          return;
        if (!background.isRunning || message || actionResult) {
          await this.turn(o, message, background);
          actionResult = false;
        }
        message = o.attention?.take();
        if (message) continue;
        if (background.isRunning) {
          await background.wait(o.attention, signal);
          message = o.attention?.take();
          if (!message && background.isSettled) {
            await background.complete();
            actionResult = true;
          }
          continue;
        }
        if (
          message === undefined &&
          memory.task.current?.status === 'running'
        ) {
          actionResult = true;
          continue;
        }
        return;
      } while (!signal.aborted);
    } finally {
      await background.cleanup();
    }
  }

  private turn(
    o: RunOptions,
    message: WorldEvent | undefined,
    background: BackgroundActionTracker,
  ) {
    return new Turn({
      options: o,
      endpoint: this.endpoint,
      request: this.request,
      message,
      actions: this.turnActions(background),
    }).run();
  }

  private turnActions(background: BackgroundActionTracker): TurnActions {
    return {
      running: () => background.isRunning,
      launch: (id, controller, work) => background.launch(id, controller, work),
      stop: () => background.stop(),
    };
  }
}

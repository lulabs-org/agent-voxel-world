import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { CommandRouter } from './command-router';

/** Shared HTTP write receipts. Reads and event subscriptions never enter this queue. */
export class ManagementCommands extends CommandRouter {
  execute<T>(
    req: Request,
    lane: string,
    action: (commandId: string) => Promise<T>,
    validate?: () => void,
  ) {
    const id = req.header('Idempotency-Key') ?? randomUUID();
    // Revision preconditions protect the first execution; a retry returns its original receipt.
    const {
      expectedTask: _task,
      expectedPlanRevision: _plan,
      ...body
    } = req.body ?? {};
    return this.run(
      id,
      { method: req.method, path: req.path, body },
      lane,
      async () => {
        validate?.();
        return action(id);
      },
      validate,
    ) as Promise<T>;
  }
}

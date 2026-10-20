import { createHash } from 'node:crypto';
import {
  GatewayError,
  publicError,
  type RpcErrorData,
} from '@voxel/gateway-protocol';
type Receipt = {
  fingerprint: string;
  at: number;
  state: 'pending' | 'committed' | 'rejected';
  result?: unknown;
  error?: RpcErrorData;
  promise: Promise<unknown>;
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
export class CommandRouter {
  private receipts = new Map<string, Receipt>();
  private lanes = new Map<string, Promise<unknown>>();
  private prune() {
    const done = [...this.receipts].filter(([, r]) => r.state !== 'pending');
    for (const [id, r] of done)
      if (Date.now() - r.at > 600000) this.receipts.delete(id);
    const remaining = [...this.receipts].filter(
      ([, r]) => r.state !== 'pending',
    );
    for (const [id] of remaining.slice(0, Math.max(0, remaining.length - 1024)))
      this.receipts.delete(id);
  }
  get(id: string) {
    this.prune();
    const r = this.receipts.get(id);
    return r
      ? { state: r.state, result: r.result, error: r.error }
      : { state: 'unknown' };
  }
  run(
    id: string,
    payload: unknown,
    lane: string,
    action: () => Promise<unknown>,
    admit?: () => void,
  ) {
    this.prune();
    const fingerprint = createHash('sha256')
        .update(canonical(payload))
        .digest('hex'),
      prior = this.receipts.get(id);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new GatewayError(
          '同一命令标识不能用于不同操作。',
          'CONFLICT',
          409,
        );
      return prior.promise;
    }
    const r: Receipt = {
      fingerprint,
      at: Date.now(),
      state: 'pending',
      promise: Promise.resolve(),
    };
    try {
      admit?.();
    } catch (error) {
      r.state = 'rejected';
      r.error = publicError(error);
      r.promise = Promise.reject(error);
      this.receipts.set(id, r);
      this.prune();
      return r.promise;
    }
    const previous = this.lanes.get(lane) ?? Promise.resolve();
    r.promise = previous
      .catch(() => {})
      .then(action)
      .then(
        (result) => {
          r.state = 'committed';
          r.at = Date.now();
          r.result = structuredClone(result);
          return result;
        },
        (error) => {
          r.state = 'rejected';
          r.at = Date.now();
          r.error = publicError(error);
          throw error;
        },
      )
      .finally(() => {
        if (this.lanes.get(lane) === r.promise) this.lanes.delete(lane);
        this.prune();
      });
    this.receipts.set(id, r);
    this.lanes.set(lane, r.promise);
    return r.promise;
  }
}

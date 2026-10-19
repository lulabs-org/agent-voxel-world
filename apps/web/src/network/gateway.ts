import { GatewayClient, UnknownOutcome } from '@voxel/gateway-client';
import type {
  RpcMethod,
  RpcParams,
  TaskIdentity,
} from '@voxel/gateway-protocol';
import { serverSocketUrl, gatewaySocketUrl } from './endpoints';
let client: GatewayClient | undefined;
let state = 'closed';
let failure = '';
type Change = {
  resource?: 'agents' | 'providers' | 'plans' | 'runs';
  agentIds?: string[];
};
const listeners = new Set<() => void>(),
  changes = new Set<(change: Change) => void>();
const identities = new Map<string, TaskIdentity | null>();
const notify = () => {
  for (const fn of listeners) fn();
};
const tokenKey = () => `agent-gateway-token:${serverSocketUrl()}`;
export const getGatewayToken = () => {
  try {
    return sessionStorage.getItem(tokenKey()) ?? '';
  } catch {
    return '';
  }
};
export function saveGatewayToken(token: string) {
  failure = '';
  sessionStorage.setItem(tokenKey(), token.trim());
  closeGateway();
  openGateway();
}
export function clearGatewayToken() {
  sessionStorage.removeItem(tokenKey());
  closeGateway();
  failure = '';
  notify();
}
export const adminHeaders = () => ({
  Authorization: `Bearer ${getGatewayToken()}`,
});
export const gatewayState = () => state;
export const gatewayError = () => failure;
export function onGatewayState(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function onGatewayChange(fn: (change: Change) => void) {
  changes.add(fn);
  return () => {
    changes.delete(fn);
  };
}
export function openGateway() {
  if (client || !getGatewayToken()) return;
  const c = new GatewayClient({
    url: gatewaySocketUrl(),
    token: getGatewayToken,
    socket: (url) => new WebSocket(url),
  });
  client = c;
  c.onOutcome((_id, receipt) => {
    if (client !== c) return;
    failure =
      receipt.state === 'committed'
        ? '断线前的操作已提交，请以当前状态为准。'
        : receipt.state === 'rejected'
          ? '断线前的操作被拒绝，请检查当前状态后重试。'
          : '断线前的操作结果待确认，请根据当前状态决定下一步。';
    notify();
  });
  c.onState((s) => {
    if (client !== c) return;
    state = s === 'connected' ? 'syncing' : s;
    notify();
  });
  c.onEvent((e) => {
    if (client !== c) return;
    if (e.event === 'snapshot') {
      state = 'ready';
      notify();
    }
    for (const fn of changes)
      fn(e.event === 'changed' ? (e.data as Change) : {});
  });
  void c.subscribe({ scope: 'all' }).catch((e) => {
    if (client === c) {
      failure = e.message;
      notify();
    }
  });
}
export function closeGateway() {
  const c = client;
  client = undefined;
  c?.close();
  state = 'closed';
  identities.clear();
  notify();
}
export async function gatewayRequest<T>(
  method: RpcMethod,
  params: RpcParams = {},
  signal?: AbortSignal,
  commandId?: string,
): Promise<T> {
  if (!client) openGateway();
  if (!client) throw Error('请先输入管理员令牌。');
  if (
    params.expectedTask === undefined &&
    (method.startsWith('tasks.') ||
      method === 'runs.control' ||
      (method === 'plans.control' && params.operation === 'run'))
  ) {
    if (!identities.has(params.agentId!)) {
      const view = await client.request<any>(
        'agents.get',
        { agentId: params.agentId },
        { signal },
      );
      identities.set(view.id, view.taskIdentity);
    }
    params = {
      ...params,
      expectedTask: identities.get(params.agentId!) ?? null,
    };
  }
  try {
    const value = await client.request<T>(method, params, {
      signal,
      commandId,
    });
    if (method === 'agents.list')
      for (const a of value as any[])
        identities.set(a.id, a.taskIdentity ?? null);
    if (method === 'agents.get') {
      const a = value as any;
      identities.set(a.id, a.taskIdentity ?? null);
    }
    return value;
  } catch (e) {
    if (e instanceof UnknownOutcome) {
      failure = e.message;
      notify();
    }
    throw e;
  }
}
/** Coalesce event-triggered reads without polling or losing a change during an active read. */
export function refreshOnGatewayChange(
  read: () => Promise<void>,
  filter: {
    resource: 'agents' | 'providers' | 'plans' | 'runs';
    agentId?: string;
  } = {
    resource: 'agents',
  },
) {
  let active = true,
    running = false,
    dirty = false;
  const refresh = async () => {
    dirty = true;
    if (running) return;
    running = true;
    try {
      while (active && dirty) {
        dirty = false;
        await read();
      }
    } finally {
      running = false;
    }
  };
  const off = onGatewayChange((change) => {
    if (
      change.resource &&
      change.resource !== filter.resource &&
      !(
        filter.resource === 'plans' &&
        ['runs', 'agents'].includes(change.resource)
      )
    )
      return;
    if (
      filter.agentId &&
      change.agentIds &&
      !change.agentIds.includes(filter.agentId)
    )
      return;
    void refresh();
  });
  void refresh();
  return () => {
    active = false;
    off();
  };
}

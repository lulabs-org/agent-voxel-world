import { serverHttpUrl } from '../../network/endpoints';
import { adminHeaders, gatewayRequest } from '../../network/gateway';
import type {
  RpcMethod,
  RpcParams,
  TaskIdentity,
} from '@voxel/gateway-protocol';
import { readAgentResponse } from './agent-response';
export async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
  expectedTask?: TaskIdentity | null,
): Promise<T> {
  if (path.startsWith('/voice-services')) {
    const response = await fetch(`${serverHttpUrl()}/agents${path}`, {
      method,
      signal,
      headers: {
        ...adminHeaders(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return readAgentResponse<T>(response);
  }
  const url = new URL(path || '/', 'http://gateway');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  let rpc: RpcMethod;
  const p: RpcParams = {};
  const value = (body ?? {}) as Record<string, unknown>;
  if (parts[0] === 'providers') {
    if (parts[1]) p.providerId = parts[1];
    rpc =
      parts[2] === 'models'
        ? 'providers.models'
        : method === 'GET'
          ? 'providers.list'
          : method === 'DELETE'
            ? 'providers.delete'
            : 'providers.save';
    if (rpc === 'providers.save') p.value = value;
  } else if (!parts.length) {
    rpc = method === 'GET' ? 'agents.list' : 'agents.create';
    if (method !== 'GET') p.value = value;
  } else {
    p.agentId = parts[0];
    if (parts[1] === 'tasks') {
      if (parts[2]) p.planId = parts[2];
      if (parts[3] === 'runs') {
        rpc = 'runs.list';
        p.offset = Number(url.searchParams.get('offset') ?? 0);
      } else if (parts[3]) {
        rpc = 'plans.control';
        p.operation = parts[3];
        p.value = value;
      } else {
        rpc =
          method === 'GET'
            ? 'plans.list'
            : method === 'PUT'
              ? 'plans.update'
              : 'plans.create';
        if (method !== 'GET') p.value = value;
      }
    } else if (parts[1] === 'task-runs') {
      rpc = 'runs.control';
      p.runId = parts[2];
      p.operation = parts[3];
      p.value = value;
    } else if (parts[1] === 'task') {
      rpc = 'tasks.assign';
      p.value = value;
    } else if (['pause', 'resume', 'cancel'].includes(parts[1])) {
      rpc = `tasks.${parts[1]}` as RpcMethod;
      if (parts[1] === 'resume') p.value = value;
    } else if (['join', 'stop', 'voice'].includes(parts[1])) {
      rpc = `agents.${parts[1]}` as RpcMethod;
      if (parts[1] === 'voice') p.value = value;
    } else {
      rpc = method === 'DELETE' ? 'agents.delete' : 'agents.update';
      if (method !== 'DELETE') p.value = value;
    }
  }
  if (expectedTask !== undefined) p.expectedTask = expectedTask;
  return gatewayRequest<T>(
    rpc,
    p,
    signal,
    typeof value.requestId === 'string' ? value.requestId : undefined,
  );
}
export const agentPath = (id: string) => `/${encodeURIComponent(id)}`;
export const providerPath = (id: string) =>
  `/providers/${encodeURIComponent(id)}`;

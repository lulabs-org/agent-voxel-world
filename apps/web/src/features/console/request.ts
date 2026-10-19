import { serverHttpUrl } from '../../network/endpoints';
import { adminHeaders } from '../../network/gateway';
import { readAgentResponse } from './agent-response';

export interface ConsoleFetchOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export async function consoleFetch<T>(
  path: string,
  options: ConsoleFetchOptions = {},
): Promise<T> {
  const { method = 'GET', body, signal, headers } = options;
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const url = `${serverHttpUrl()}/agents${normalizedPath}`;
  const response = await fetch(url, {
    method,
    signal,
    headers: {
      ...adminHeaders(),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return readAgentResponse<T>(response);
}

/**
 * @deprecated 建议直接使用具体的子 API（providersApi, agentsApi, tasksApi, voiceApi）或 consoleFetch
 */
export async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return consoleFetch<T>(path, { method, body, signal });
}

export const agentPath = (id: string) => `/${encodeURIComponent(id)}`;
export const providerPath = (id: string) =>
  `/providers/${encodeURIComponent(id)}`;

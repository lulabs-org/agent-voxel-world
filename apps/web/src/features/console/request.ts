import { serverHttpUrl } from '../../network/endpoints';
import { getGatewayToken, reportUnknownOutcome } from '../../network/gateway';
import {
  managementRequest,
  UnknownOutcome,
} from '@voxel/shared/management-client';

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
  const url = `${serverHttpUrl()}${normalizedPath}`;
  try {
    return await managementRequest<T>(url, {
      token: getGatewayToken(),
      method,
      body,
      signal,
      headers,
    });
  } catch (error) {
    if (error instanceof UnknownOutcome) reportUnknownOutcome(error);
    throw error;
  }
}

/**
 * @deprecated 建议直接使用具体的子 API（providersApi, aiCharactersApi, tasksApi, voiceApi）或 consoleFetch
 */
export async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return consoleFetch<T>(path, { method, body, signal });
}

export const aiCharacterPath = (id: string) =>
  `/ai-characters/${encodeURIComponent(id)}`;
export const providerPath = (id: string) =>
  `/providers/${encodeURIComponent(id)}`;

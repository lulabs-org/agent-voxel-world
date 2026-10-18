import type { AsrServiceDraft, AsrServiceView } from '@voxel/shared';
import type { SpeechCapabilities } from '../../audio';
import { serverHttpUrl } from '../../network/endpoints';

async function asrRequest<T>(
  path: string,
  method: string,
  signal: AbortSignal,
  draft?: AsrServiceDraft,
): Promise<T> {
  const response = await fetch(`${serverHttpUrl()}/voice/asr/services${path}`, {
    method,
    signal,
    headers: draft ? { 'Content-Type': 'application/json' } : undefined,
    body: draft ? JSON.stringify(draft) : undefined,
  });
  if (response.status === 204) return undefined as T;
  const value = await response.json();
  if (!response.ok) throw Error(value.error || '无法读取识别服务配置。');
  return value;
}

export const voiceApi = {
  listAsrServices: (signal: AbortSignal) =>
    asrRequest<AsrServiceView[]>('', 'GET', signal),
  saveAsrService: (draft: AsrServiceDraft, signal: AbortSignal, id?: string) =>
    asrRequest<AsrServiceView>(
      id ? `/${encodeURIComponent(id)}` : '',
      id ? 'PUT' : 'POST',
      signal,
      draft,
    ),
  deleteAsrService: (id: string, signal: AbortSignal) =>
    asrRequest<void>(`/${encodeURIComponent(id)}`, 'DELETE', signal),
  async capabilities(
    signal: AbortSignal,
    serviceId?: string,
  ): Promise<SpeechCapabilities> {
    const response = await fetch(
      `${serverHttpUrl()}/voice/capabilities${serviceId ? `?serviceId=${encodeURIComponent(serviceId)}` : ''}`,
      {
        signal,
      },
    );
    if (!response.ok) throw Error('capabilities');
    const value = await response.json();
    if (typeof value.local?.available !== 'boolean')
      throw Error('capabilities');
    return value;
  },
};

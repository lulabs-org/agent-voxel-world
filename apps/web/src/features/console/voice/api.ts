import type {
  PiperModelView,
  VoiceServiceDraft,
  VoiceServiceView,
} from '@voxel/shared';
import { serverHttpUrl } from '../../../network/endpoints';
import { readAgentResponse } from '../agent-response';
import { request } from '../request';
export const voiceApi = {
  listPiperModels: (signal?: AbortSignal) =>
    request<PiperModelView[]>(
      '/voice-services/piper/models',
      'GET',
      undefined,
      signal,
    ),
  installPiperModel: (model: string, signal?: AbortSignal) =>
    request<{ model: string; state: 'installing' }>(
      '/voice-services/piper/install',
      'POST',
      { model },
      signal,
    ),
  listVoiceServices: (signal?: AbortSignal) =>
    request<VoiceServiceView[]>('/voice-services', 'GET', undefined, signal),
  saveVoiceService: (draft: VoiceServiceDraft, id?: string) =>
    request<VoiceServiceView>(
      id ? `/voice-services/${encodeURIComponent(id)}` : '/voice-services',
      id ? 'PUT' : 'POST',
      draft,
    ),
  deleteVoiceService: (id: string) =>
    request<void>(`/voice-services/${encodeURIComponent(id)}`, 'DELETE'),
  previewVoice: async (id: string, text: string, signal: AbortSignal) => {
    const response = await fetch(
      `${serverHttpUrl()}/agents/voice-services/${encodeURIComponent(id)}/preview`,
      {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      },
    );
    if (!response.ok) await readAgentResponse(response);
    if (!response.headers.get('content-type')?.startsWith('audio/wav'))
      throw Error('语音服务未返回可播放的音频。');
    return response.blob();
  },
};

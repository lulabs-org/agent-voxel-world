import { adminHeaders } from '../../../network/gateway';
import type {
  PiperModelView,
  VoiceServiceDraft,
  VoiceServiceView,
} from '@voxel/shared';
import { serverHttpUrl } from '../../../network/endpoints';
import { readAgentResponse } from '../agent-response';
import { consoleFetch } from '../request';

export const voiceApi = {
  listPiperModels: (signal?: AbortSignal) =>
    consoleFetch<PiperModelView[]>('/voice-services/piper/models', { signal }),
  installPiperModel: (model: string, signal?: AbortSignal) =>
    consoleFetch<{ model: string; state: 'installing' }>(
      '/voice-services/piper/install',
      {
        method: 'POST',
        body: { model },
        signal,
      },
    ),
  listVoiceServices: (signal?: AbortSignal) =>
    consoleFetch<VoiceServiceView[]>('/voice-services', { signal }),
  saveVoiceService: (draft: VoiceServiceDraft, id?: string) =>
    consoleFetch<VoiceServiceView>(
      id ? `/voice-services/${encodeURIComponent(id)}` : '/voice-services',
      {
        method: id ? 'PUT' : 'POST',
        body: draft,
      },
    ),
  deleteVoiceService: (id: string) =>
    consoleFetch<void>(`/voice-services/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  previewVoice: async (id: string, text: string, signal: AbortSignal) => {
    const response = await fetch(
      `${serverHttpUrl()}/agents/voice-services/${encodeURIComponent(id)}/preview`,
      {
        method: 'POST',
        signal,
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      },
    );
    if (!response.ok) await readAgentResponse(response);
    if (!response.headers.get('content-type')?.startsWith('audio/wav'))
      throw Error('语音服务未返回可播放的音频。');
    return response.blob();
  },
};

import type { AICharacterSettings, AICharacterView } from '@voxel/shared';
import { consoleFetch } from '../request';

export const aiCharactersApi = {
  listAgents: (signal?: AbortSignal) =>
    consoleFetch<AICharacterView[]>('/ai-characters', { signal }),
  saveAgent: (
    settings: Partial<Omit<AICharacterSettings, 'goal'>> & {
      joinWorld?: boolean;
    },
    id?: string,
  ) =>
    consoleFetch<AICharacterView>(
      id ? `/ai-characters/${encodeURIComponent(id)}` : '/ai-characters',
      {
        method: id ? 'PUT' : 'POST',
        body: settings,
      },
    ),
  joinAgent: (id: string) =>
    consoleFetch<void>(`/ai-characters/${encodeURIComponent(id)}/join`, {
      method: 'POST',
      body: {},
    }),
  stopAgent: (id: string) =>
    consoleFetch<void>(`/ai-characters/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
      body: {},
    }),
  deleteAgent: (id: string) =>
    consoleFetch<void>(`/ai-characters/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  setVoiceReplies: (id: string, enabled: boolean) =>
    consoleFetch<AICharacterView>(
      `/ai-characters/${encodeURIComponent(id)}/voice`,
      {
        method: 'POST',
        body: { enabled },
      },
    ),
};

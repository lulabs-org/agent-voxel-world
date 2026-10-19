import type { AgentSettings, ManagedAgentView } from '@voxel/shared';
import { consoleFetch } from '../request';

export const agentsApi = {
  listAgents: (signal?: AbortSignal) =>
    consoleFetch<ManagedAgentView[]>('', { signal }),
  saveAgent: (
    settings: Partial<AgentSettings> & {
      startTask?: boolean;
      joinWorld?: boolean;
    },
    id?: string,
  ) =>
    consoleFetch<ManagedAgentView>(id ? `/${encodeURIComponent(id)}` : '', {
      method: id ? 'PUT' : 'POST',
      body: settings,
    }),
  joinAgent: (id: string) =>
    consoleFetch<void>(`/${encodeURIComponent(id)}/join`, {
      method: 'POST',
      body: {},
    }),
  stopAgent: (id: string) =>
    consoleFetch<void>(`/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
      body: {},
    }),
  deleteAgent: (id: string) =>
    consoleFetch<void>(`/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  setVoiceReplies: (id: string, enabled: boolean) =>
    consoleFetch<ManagedAgentView>(`/${encodeURIComponent(id)}/voice`, {
      method: 'POST',
      body: { enabled },
    }),
};

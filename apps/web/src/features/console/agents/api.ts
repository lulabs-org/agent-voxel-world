import type { AgentSettings, ManagedAgentView } from '@voxel/shared';
import { consoleFetch } from '../request';

export const agentsApi = {
  listAgents: (signal?: AbortSignal) =>
    consoleFetch<ManagedAgentView[]>('/agents', { signal }),
  saveAgent: (
    settings: Partial<AgentSettings> & {
      startTask?: boolean;
      joinWorld?: boolean;
    },
    id?: string,
  ) =>
    consoleFetch<ManagedAgentView>(
      id ? `/agents/${encodeURIComponent(id)}` : '/agents',
      {
        method: id ? 'PUT' : 'POST',
        body: settings,
      },
    ),
  joinAgent: (id: string) =>
    consoleFetch<void>(`/agents/${encodeURIComponent(id)}/join`, {
      method: 'POST',
      body: {},
    }),
  stopAgent: (id: string) =>
    consoleFetch<void>(`/agents/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
      body: {},
    }),
  deleteAgent: (id: string) =>
    consoleFetch<void>(`/agents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  setVoiceReplies: (id: string, enabled: boolean) =>
    consoleFetch<ManagedAgentView>(`/agents/${encodeURIComponent(id)}/voice`, {
      method: 'POST',
      body: { enabled },
    }),
};

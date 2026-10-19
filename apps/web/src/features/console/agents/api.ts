import type { AgentSettings, ManagedAgentView } from '@voxel/shared';
import { agentPath, request } from '../request';
export const agentsApi = {
  listAgents: (signal?: AbortSignal) =>
    request<ManagedAgentView[]>('', 'GET', undefined, signal),
  saveAgent: (
    settings: Partial<AgentSettings> & {
      startTask?: boolean;
      joinWorld?: boolean;
    },
    id?: string,
  ) =>
    request<ManagedAgentView>(
      id ? agentPath(id) : '',
      id ? 'PUT' : 'POST',
      settings,
    ),
  joinAgent: (id: string) => request<void>(`${agentPath(id)}/join`, 'POST', {}),
  stopAgent: (id: string) => request<void>(`${agentPath(id)}/stop`, 'POST', {}),
  deleteAgent: (id: string) => request<void>(agentPath(id), 'DELETE'),
  setVoiceReplies: (id: string, enabled: boolean) =>
    request<ManagedAgentView>(`${agentPath(id)}/voice`, 'POST', { enabled }),
};

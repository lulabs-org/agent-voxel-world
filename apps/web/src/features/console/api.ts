import type { PiperModelView } from '@voxel/shared';
import type {
  AgentSettings,
  TaskPlanDraft,
  TaskPlan,
  TaskRunPage,
  ManagedAgentView,
  ProviderView,
  VoiceServiceView,
  VoiceServiceDraft,
} from '@voxel/shared';
import { serverHttpUrl } from '../../network/endpoints';
import { readAgentResponse } from './agent-response';
import type { ProviderDraft } from './model';
import type { TaskBudget } from './TaskBudgetFields';

async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${serverHttpUrl()}/agents${path}`, {
    method,
    signal,
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return readAgentResponse<T>(response);
}

const agentPath = (id: string) => `/${encodeURIComponent(id)}`;
const providerPath = (id: string) => `/providers/${encodeURIComponent(id)}`;

export const consoleApi = {
  listTaskPlans: (id: string, signal?: AbortSignal) =>
    request<TaskPlan[]>(`${agentPath(id)}/tasks`, 'GET', undefined, signal),
  saveTaskPlan: (
    id: string,
    draft: TaskPlanDraft,
    planId?: string,
    requestId?: string,
  ) =>
    request<TaskPlan>(
      `${agentPath(id)}/tasks${planId ? `/${encodeURIComponent(planId)}` : ''}`,
      planId ? 'PUT' : 'POST',
      { ...draft, requestId },
    ),
  taskPlanAction: (
    id: string,
    planId: string,
    operation: 'run' | 'pause' | 'resume' | 'archive' | 'extend',
    body: unknown = {},
  ) =>
    request<void>(
      `${agentPath(id)}/tasks/${encodeURIComponent(planId)}/${operation}`,
      'POST',
      body,
    ),
  listTaskRuns: (
    id: string,
    planId: string,
    offset = 0,
    signal?: AbortSignal,
  ) =>
    request<TaskRunPage>(
      `${agentPath(id)}/tasks/${encodeURIComponent(planId)}/runs?offset=${offset}`,
      'GET',
      undefined,
      signal,
    ),
  taskRunAction: (
    id: string,
    runId: string,
    operation: 'pause' | 'resume' | 'cancel',
    limits?: TaskBudget,
  ) =>
    request<void>(
      `${agentPath(id)}/task-runs/${encodeURIComponent(runId)}/${operation}`,
      'POST',
      limits ?? {},
    ),
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
  listProviders: (signal?: AbortSignal) =>
    request<ProviderView[]>('/providers', 'GET', undefined, signal),
  listAgents: (signal?: AbortSignal) =>
    request<ManagedAgentView[]>('', 'GET', undefined, signal),
  listModels: (id: string, signal?: AbortSignal) =>
    request<{ models: string[] }>(
      `${providerPath(id)}/models`,
      'GET',
      undefined,
      signal,
    ),
  saveProvider: (draft: ProviderDraft, id?: string) =>
    request<ProviderView>(
      id ? providerPath(id) : '/providers',
      id ? 'PUT' : 'POST',
      draft,
    ),
  deleteProvider: (id: string) => request<void>(providerPath(id), 'DELETE'),
  saveAgent: (
    settings: Partial<AgentSettings> & {
      startTask?: boolean;
      taskTimeZone?: string;
    },
    id?: string,
  ) =>
    request<ManagedAgentView>(
      id ? agentPath(id) : '',
      id ? 'PUT' : 'POST',
      settings,
    ),
  resumeAgent: (id: string, limits?: TaskBudget) =>
    request<void>(`${agentPath(id)}/resume`, 'POST', limits ?? {}),
  joinAgent: (id: string) => request<void>(`${agentPath(id)}/join`, 'POST', {}),
  pauseAgent: (id: string) =>
    request<void>(`${agentPath(id)}/pause`, 'POST', {}),
  cancelTask: (id: string) =>
    request<void>(`${agentPath(id)}/cancel`, 'POST', {}),
  stopAgent: (id: string) => request<void>(`${agentPath(id)}/stop`, 'POST', {}),
  deleteAgent: (id: string) => request<void>(agentPath(id), 'DELETE'),
  assignTask: (id: string, goal: string, limits?: TaskBudget) =>
    request<void>(`${agentPath(id)}/task`, 'POST', { goal, ...limits }),
  setVoiceReplies: (id: string, enabled: boolean) =>
    request<ManagedAgentView>(`${agentPath(id)}/voice`, 'POST', { enabled }),
};

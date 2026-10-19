import type { ProviderView } from '@voxel/shared';
import type { ProviderDraft } from '../providers/model';
import { consoleFetch } from '../request';

export const providersApi = {
  listProviders: (signal?: AbortSignal) =>
    consoleFetch<ProviderView[]>('/providers', { signal }),
  listModels: (id: string, signal?: AbortSignal) =>
    consoleFetch<{ models: string[] }>(
      `/providers/${encodeURIComponent(id)}/models`,
      { signal },
    ),
  saveProvider: (draft: ProviderDraft, id?: string) =>
    consoleFetch<ProviderView>(
      id ? `/providers/${encodeURIComponent(id)}` : '/providers',
      {
        method: id ? 'PUT' : 'POST',
        body: draft,
      },
    ),
  deleteProvider: (id: string) =>
    consoleFetch<void>(`/providers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};

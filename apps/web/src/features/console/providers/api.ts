import type { ProviderView } from '@voxel/shared';
import type { ProviderDraft } from '../providers/model';
import { providerPath, request } from '../request';
export const providersApi = {
  listProviders: (signal?: AbortSignal) =>
    request<ProviderView[]>('/providers', 'GET', undefined, signal),
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
};

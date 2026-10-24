import OpenAI from 'openai';
import type { ModelEndpoint } from '../../contracts';
export async function listModels(
  endpoint: ModelEndpoint,
  apiKey: string,
  request: typeof fetch = fetch,
): Promise<string[]> {
  const client = new OpenAI({
    baseURL: endpoint.baseUrl,
    apiKey: apiKey || 'ollama',
    maxRetries: 0,
    timeout: 10000,
    fetch: request,
    fetchOptions: { redirect: 'error' },
  });
  const page = await client.models.list();
  return [
    ...new Set(
      page.data.map((m) => m.id).filter((id) => typeof id === 'string'),
    ),
  ]
    .slice(0, 200)
    .sort();
}

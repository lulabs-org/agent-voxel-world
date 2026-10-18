import type {
  ProviderInference,
  ProviderType,
  ProviderView,
} from '@voxel/shared';
export const presets = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
  },
  ollama: {
    name: '本机 Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: '',
  },
  compatible: { name: 'OpenAI 兼容服务', baseUrl: '', defaultModel: '' },
};
export const defaultInference: ProviderInference = {
  timeoutMs: 60000,
  maxTokens: 512,
  thinking: 'disabled',
  reasoningEffort: 'high',
};
export const freshProvider = (type: ProviderType = 'compatible') => ({
  ...presets[type],
  name: '',
  type,
  apiKey: '',
  inference: { ...defaultInference },
  jsonMode: true,
  tokenField: 'max_tokens' as ProviderView['tokenField'],
});
export type ProviderDraft = ReturnType<typeof freshProvider>;

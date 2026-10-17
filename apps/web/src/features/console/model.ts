import type {
  AgentSettings,
  AgentTaskStatus,
  ProviderType,
  ProviderView,
  ProviderInference,
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
export const taskStatusNames: Record<AgentTaskStatus, string> = {
  running: '执行任务',
  waiting: '等待环境变化',
  needs_input: '等待你的答复',
  blocked: '任务受阻',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
  budget: '额度用尽 · 已暂停',
};
export const initialAgent: AgentSettings = {
  providerId: '',
  model: '',
  name: '',
  goal: '',
  roleDescription: '',
  continuous: false,
  intervalMode: 'fixed',
  intervalMinMs: 4000,
  intervalMaxMs: 8000,
  maxTurns: 100,
  tokenBudget: 50000,
  taskTimeoutMs: 900000,
  intervalMs: 3000,
  timeoutMs: 60000,
  maxTokens: 512,
  allowEdits: false,
  permissions: { move: true, chat: true, place: false, remove: false },
  skills: [],
  voiceReplies: false,
  voiceServiceId: '',
  thinking: 'disabled',
  reasoningEffort: 'high',
};
export type ProviderDraft = ReturnType<typeof freshProvider>;

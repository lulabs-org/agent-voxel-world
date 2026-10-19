import { ManagementError } from './errors';
import { randomUUID } from 'node:crypto';
import {
  AGENT_ROLE_DESCRIPTION_LIMIT,
  validateCapabilities,
  type AgentSettings,
  type ProviderInference,
  type ProviderView,
} from '@voxel/shared';

export type SavedProvider = Omit<ProviderView, 'hasApiKey'> & {
  apiKey: string;
};

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ManagementError('请求格式无效。');
  return value as Record<string, unknown>;
}

export function text(
  value: unknown,
  label: string,
  max: number,
  fallback = '',
) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max)
    throw new ManagementError(`${label}格式无效。`);
  return value.trim();
}

export function integer(
  value: unknown,
  label: string,
  fallback: number,
  min: number,
  max: number,
) {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new ManagementError(`${label}须为 ${min}–${max} 的整数。`);
  return value;
}

export function boolean(value: unknown, fallback: boolean) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new ManagementError('开关参数无效。');
  return value;
}

export function validateProvider(
  value: unknown,
  previous?: SavedProvider,
): SavedProvider {
  const input = object(value);
  const type = input.type;
  if (type !== 'deepseek' && type !== 'ollama' && type !== 'compatible')
    throw new ManagementError('不支持此服务类型。');
  const name = text(input.name, '服务名称', 50);
  if (!name) throw new ManagementError('请输入服务名称。');
  const defaults = {
    deepseek: 'https://api.deepseek.com',
    ollama: 'http://127.0.0.1:11434/v1',
    compatible: '',
  };
  let url: URL;
  try {
    url = new URL(text(input.baseUrl, '接口地址', 500, defaults[type]));
  } catch {
    throw new ManagementError('请输入有效的 API Base URL。');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  )
    throw new ManagementError(
      '接口须为 HTTPS 或本机 HTTP 地址，不能包含密码、查询参数或锚点。',
    );
  if (type === 'deepseek' && url.origin !== 'https://api.deepseek.com')
    throw new ManagementError(
      'DeepSeek 使用官方地址；第三方网关请选择 OpenAI 兼容服务。',
    );
  if (type === 'ollama' && !loopback)
    throw new ManagementError('本机 Ollama 仅支持本机地址。');
  const baseUrl = url.href.replace(/\/$/, '');
  const apiKey = text(input.apiKey, 'API Key', 4096);
  if (
    previous?.apiKey &&
    !apiKey &&
    (new URL(previous.baseUrl).origin !== url.origin || previous.type !== type)
  )
    throw new ManagementError('更换服务地址或类型时，请重新填写 API Key。');
  const tokenField = input.tokenField ?? 'max_tokens';
  if (tokenField !== 'max_tokens' && tokenField !== 'max_completion_tokens')
    throw new ManagementError('输出长度参数无效。');
  return {
    id: previous?.id ?? randomUUID(),
    name,
    type,
    baseUrl,
    apiKey: apiKey || previous?.apiKey || '',
    defaultModel: text(input.defaultModel, '默认模型', 128),
    jsonMode: boolean(input.jsonMode, true),
    tokenField: type === 'compatible' ? tokenField : 'max_tokens',
    inference:
      input.inference === undefined
        ? previous?.inference && validateInference(previous.inference, type)
        : validateInference(object(input.inference), type),
  };
}

export function validateInference(
  input: Record<string, unknown>,
  type: ProviderView['type'],
): ProviderInference {
  const thinking = input.thinking ?? 'disabled';
  const reasoningEffort = input.reasoningEffort ?? 'high';
  if (thinking !== 'enabled' && thinking !== 'disabled')
    throw new ManagementError('思考模式无效。');
  if (
    typeof reasoningEffort !== 'string' ||
    !['none', 'low', 'high', 'max'].includes(reasoningEffort)
  )
    throw new ManagementError('推理强度无效。');
  if (type !== 'deepseek' && thinking !== 'disabled')
    throw new ManagementError('此模型服务暂不提供 DeepSeek 思考参数。');
  return {
    thinking,
    reasoningEffort: reasoningEffort as AgentSettings['reasoningEffort'],
    timeoutMs: integer(input.timeoutMs, '推理超时', 60000, 1000, 120000),
    maxTokens: integer(
      input.maxTokens,
      '输出长度',
      thinking === 'enabled' ? 4096 : 512,
      128,
      16384,
    ),
  };
}

export function taskLimits(input: Record<string, unknown>) {
  return Object.fromEntries(
    ['maxTurns', 'tokenBudget', 'taskTimeoutMs']
      .filter((key) => input[key] !== undefined)
      .map((key) => [key, input[key]]),
  );
}

export function validateAgent(
  value: unknown,
  provider: SavedProvider,
): AgentSettings {
  const input: Record<string, unknown> = {
    ...object(value),
    ...provider.inference,
  };
  const model = text(input.model, '模型', 128, provider.defaultModel);
  if (!model || !/^[a-zA-Z0-9][a-zA-Z0-9._:/+\-]{0,127}$/.test(model))
    throw new ManagementError('请输入有效模型 ID。');
  if (provider.type === 'ollama' && /cloud/i.test(model))
    throw new ManagementError('本机 Ollama 请选择已下载的本地模型。');
  if (provider.type !== 'ollama' && !provider.apiKey)
    throw new ManagementError('请先为该模型服务配置 API Key。');
  const name = text(input.name, '玩家昵称', 24);
  const goal = text(input.goal, '任务目标', 2000);
  if (!name) throw new ManagementError('请填写玩家昵称。');
  const inference = validateInference(input, provider.type);
  const intervalMode = input.intervalMode ?? 'fixed';
  if (intervalMode !== 'fixed' && intervalMode !== 'random')
    throw new ManagementError('轮询方式无效。');
  const intervalMinMs = integer(
    input.intervalMinMs,
    '随机间隔下限',
    4000,
    1000,
    60000,
  );
  const intervalMaxMs = integer(
    input.intervalMaxMs,
    '随机间隔上限',
    8000,
    1000,
    60000,
  );
  if (intervalMinMs > intervalMaxMs)
    throw new ManagementError('随机间隔下限不能大于上限。');
  let capabilities;
  try {
    capabilities = validateCapabilities(input);
  } catch (error) {
    throw new ManagementError(
      error instanceof Error ? error.message : '角色能力无效。',
    );
  }
  return {
    ...capabilities,
    continuous: boolean(input.continuous, false),
    intervalMode,
    intervalMinMs,
    intervalMaxMs,
    providerId: provider.id,
    model,
    name,
    goal,
    roleDescription: text(
      input.roleDescription,
      '角色设定',
      AGENT_ROLE_DESCRIPTION_LIMIT,
    ),
    ...inference,
    maxTurns: integer(input.maxTurns, '任务调用上限', 100, 1, 200),
    tokenBudget: integer(
      input.tokenBudget,
      '任务 token 预算',
      50000,
      1000,
      1000000,
    ),
    taskTimeoutMs: integer(
      input.taskTimeoutMs,
      '任务时间上限',
      900000,
      1000,
      7200000,
    ),
    intervalMs: integer(input.intervalMs, '轮次间隔', 3000, 1000, 60000),
    allowEdits:
      capabilities.permissions.place && capabilities.permissions.remove,
    voiceReplies: boolean(input.voiceReplies, false),
    voiceServiceId: text(
      input.voiceServiceId,
      '语音服务',
      80,
      input.voiceReplies ? 'local-default' : '',
    ),
  };
}

export const providerView = ({
  apiKey,
  ...provider
}: SavedProvider): ProviderView => ({ ...provider, hasApiKey: !!apiKey });

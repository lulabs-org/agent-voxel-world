import { AppError } from '../../common/errors';
import { object, text, integer, boolean } from '../../common/validation';
import {
  AGENT_ROLE_DESCRIPTION_LIMIT,
  validateCapabilities,
  type AgentSettings,
} from '@voxel/shared';
import {
  validateInference,
  type SavedProvider,
} from '../providers/provider-validation';

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
    throw new AppError('请输入有效模型 ID。');
  if (provider.type === 'ollama' && /cloud/i.test(model))
    throw new AppError('本机 Ollama 请选择已下载的本地模型。');
  if (provider.type !== 'ollama' && !provider.apiKey)
    throw new AppError('请先为该模型服务配置 API Key。');
  const name = text(input.name, '玩家昵称', 24);
  const goal = text(input.goal, '任务目标', 2000);
  if (!name) throw new AppError('请填写玩家昵称。');
  const inference = validateInference(input, provider.type);
  const intervalMode = input.intervalMode ?? 'fixed';
  if (intervalMode !== 'fixed' && intervalMode !== 'random')
    throw new AppError('轮询方式无效。');
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
    throw new AppError('随机间隔下限不能大于上限。');
  let capabilities;
  try {
    capabilities = validateCapabilities(input);
  } catch (error) {
    throw new AppError(
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

/** Public profile writes cannot create or replace task execution. Empty legacy goals are harmless. */
export function agentProfileInput(value: unknown) {
  const input = object(value);
  if (
    input.startTask !== undefined ||
    input.taskTimeZone !== undefined ||
    (input.goal !== undefined && input.goal !== '')
  )
    throw new AppError(
      'Agent 配置不接受任务参数，请通过 Tasks 创建或修改任务。',
    );
  return input;
}

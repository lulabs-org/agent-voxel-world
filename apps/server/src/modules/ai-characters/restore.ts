import type { AICharacterSettings } from '@voxel/shared';
import { AgentAttention } from '@voxel/agent-runtime';
import type { PlanService } from '../tasks/service';
import { restoreAICharacterLogs } from './logs';
import { validateAICharacter } from './validation';
import { AppError } from '../../common/errors';
import type { ProviderPort, RestoredAICharacterRecord } from './ports';
import type { Job } from './types';
import { restoreTaskExecution, restoreTaskMemory } from '../tasks/restore';
import { executionState } from './execution-adapter';

export function restoreAICharacterJob(
  view: RestoredAICharacterRecord,
  providers: ProviderPort,
  checkVoice: (settings: AICharacterSettings) => void,
  ledger: PlanService,
): { job: Job; voiceWarning?: string; shouldAutoJoin: boolean } {
  const provider = providers.get(view.providerId);
  const settings = validateAICharacter(view, provider);
  let voiceWarning = '';
  try {
    checkVoice(settings);
  } catch {
    settings.voiceReplies = false;
    settings.voiceServiceId = '';
    voiceWarning = '原语音服务不可用，已保留文字回复；请重新选择语音服务。';
  }
  if (typeof view.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(view.id))
    throw new AppError('Agent 标识无效。', 500);

  const job: Job = {
    view: {
      ...settings,
      id: view.id,
      createdAt: view.createdAt,
      providerName: provider.name,
      status: 'stopped',
      ...restoreAICharacterLogs(view.logs, view.logTimes),
    },
    abort: new AbortController(),
    memory: restoreTaskMemory(view.runtime, view.task, settings.goal),
    attention: new AgentAttention(),
    ledger,
    currentRunId: view.currentRunId,
  };

  restoreTaskExecution(
    executionState(job),
    !view.currentRunId && !!view.runtime?.task,
  );

  const shouldAutoJoin = ['idle', 'running', 'joining', 'failed'].includes(
    view.status,
  );

  return { job, voiceWarning: voiceWarning || undefined, shouldAutoJoin };
}

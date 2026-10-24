import { useState } from 'react';
import type { AICharacterSummary, TaskLimits } from '@voxel/shared';
import { useI18n } from '../../../../i18n/context';
import { displayedTaskIdentity, controlTaskRun } from '../../execution/api';
export function useCurrentTaskBudget(
  job: AICharacterSummary,
  onUpdated: () => Promise<void>,
) {
  const { t } = useI18n();
  const execution = job.taskExecution;
  const task = job.task;
  const [draft, setDraft] = useState<{
    limits: TaskLimits;
    expectedTask: ReturnType<typeof displayedTaskIdentity>;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const control = async (operation: 'pause' | 'cancel') => {
    if (!execution) return;
    setBusy(true);
    setError('');
    try {
      await controlTaskRun(
        execution.runId,
        operation,
        {},
        displayedTaskIdentity(job),
      );
      setDraft(undefined);
      await onUpdated();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('console.characters.operationFailed'),
      );
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    if (!execution || !task || !draft) return;
    const limited = execution.limits.enabled !== false;
    const limits = draft.limits;
    if (
      limited &&
      (limits.maxTurns <= task.calls ||
        limits.tokenBudget <= task.tokens ||
        limits.taskTimeoutMs <= task.elapsedMs)
    ) {
      setError(t('console.characters.budgetLowerThanUsedError'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await controlTaskRun(
        execution.runId,
        'resume',
        { ...limits },
        draft.expectedTask,
      );
      setDraft(undefined);
      await onUpdated();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('console.characters.resumeFailed'),
      );
    } finally {
      setBusy(false);
    }
  };
  const beginResume = () => {
    if (!execution) return;
    setError('');
    setDraft({
      limits: { ...execution.limits },
      expectedTask: displayedTaskIdentity(job),
    });
  };
  const cancelResume = () => {
    setDraft(undefined);
    setError('');
  };
  const updateLimits = (limits: Partial<TaskLimits>) => {
    if (draft) setDraft({ ...draft, limits: { ...draft.limits, ...limits } });
  };
  return {
    draft,
    busy,
    error,
    control,
    resume,
    beginResume,
    cancelResume,
    updateLimits,
  };
}

import { AI_CHARACTER_LOG_LIMIT, type AICharacterView } from '@voxel/shared';

type LogView = Pick<AICharacterView, 'logs' | 'logTimes'>;

export function restoreAICharacterLogs(
  logs: unknown,
  times: unknown,
): Required<LogView> {
  const entries = (Array.isArray(logs) ? logs : [])
    .flatMap((message, index) => {
      if (typeof message !== 'string') return [];
      const time = Array.isArray(times) ? times[index] : undefined;
      return [
        {
          message,
          time:
            typeof time === 'number' &&
            Number.isFinite(time) &&
            time >= 0 &&
            time <= 8.64e15
              ? time
              : null,
        },
      ];
    })
    .slice(-AI_CHARACTER_LOG_LIMIT);
  return {
    logs: entries.map((e) => e.message),
    logTimes: entries.map((e) => e.time),
  };
}

export function appendAICharacterLog(
  view: LogView,
  message: string,
  now = Date.now(),
) {
  const previous = restoreAICharacterLogs(view.logs, view.logTimes);
  view.logs = [...previous.logs, message].slice(-AI_CHARACTER_LOG_LIMIT);
  view.logTimes = [...previous.logTimes, now].slice(-AI_CHARACTER_LOG_LIMIT);
}

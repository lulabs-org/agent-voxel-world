import { AGENT_LOG_LIMIT, type ManagedAgentView } from '@voxel/shared';

type LogView = Pick<ManagedAgentView, 'logs' | 'logTimes'>;

export function restoreAgentLogs(
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
    .slice(-AGENT_LOG_LIMIT);
  return {
    logs: entries.map((e) => e.message),
    logTimes: entries.map((e) => e.time),
  };
}

export function appendAgentLog(
  view: LogView,
  message: string,
  now = Date.now(),
) {
  const previous = restoreAgentLogs(view.logs, view.logTimes);
  view.logs = [...previous.logs, message].slice(-AGENT_LOG_LIMIT);
  view.logTimes = [...previous.logTimes, now].slice(-AGENT_LOG_LIMIT);
}

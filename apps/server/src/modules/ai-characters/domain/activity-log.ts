import { AI_CHARACTER_LOG_LIMIT, type AICharacterView } from '@voxel/shared';

type LogView = Pick<AICharacterView, 'logs' | 'logTimes'>;

/** 校验并清洗反序列化后的角色日志及时间戳，限制在最大条数范围内 */
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

/** 向角色的内存日志数组追加一条记录并维持上限 */
export function appendAICharacterLog(
  view: LogView,
  message: string,
  now = Date.now(),
) {
  const previous = restoreAICharacterLogs(view.logs, view.logTimes);
  view.logs = [...previous.logs, message].slice(-AI_CHARACTER_LOG_LIMIT);
  view.logTimes = [...previous.logTimes, now].slice(-AI_CHARACTER_LOG_LIMIT);
}

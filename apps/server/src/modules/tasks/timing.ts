import { zonedDateParts, wallClockInstant, type TaskPlan } from '@voxel/shared';
export function nextOccurrence(
  plan: Pick<TaskPlan, 'timing' | 'timeZone' | 'createdAt'>,
  after: number,
): number | undefined {
  const t = plan.timing;
  if (t.kind === 'immediate') return undefined;
  if (t.kind === 'once') return t.at > after ? t.at : undefined;
  if (t.kind === 'interval')
    return (
      plan.createdAt +
      Math.max(1, Math.floor((after - plan.createdAt) / t.everyMs) + 1) *
        t.everyMs
    );
  const [y, m, d] = zonedDateParts(after, plan.timeZone);
  for (let offset = 0; offset <= 14; offset++) {
    const day = new Date(Date.UTC(y, m - 1, d + offset));
    if (t.kind === 'weekly' && !t.weekdays.includes(day.getUTCDay())) continue;
    const candidate = wallClockInstant(
      day.toISOString().slice(0, 10),
      t.time,
      plan.timeZone,
    );
    if (candidate !== undefined && candidate > after) return candidate;
  }
  throw new Error('无法计算下次执行时间。');
}

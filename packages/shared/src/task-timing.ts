import type { TaskPlan } from './task-plans.js';
function localParts(ms: number, zone: string) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ms);
  const n = (key: string) => Number(p.find((x) => x.type === key)!.value);
  return [n('year'), n('month'), n('day'), n('hour'), n('minute'), n('second')];
}
/** Resolve a wall clock time, choosing the first fold and rejecting DST gaps. */
export function wallClockInstant(
  date: string,
  time: string,
  zone: string,
): number | undefined {
  const [y, m, d] = date.split('-').map(Number),
    [h, min] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  const candidates = new Set<number>();
  for (const delta of [-36, -24, -12, 0, 12, 24, 36]) {
    const probe = wall + delta * 3600000;
    const [py, pm, pd, ph, pmin, ps] = localParts(probe, zone);
    const offset = Date.UTC(py, pm - 1, pd, ph, pmin, ps) - probe;
    const instant = wall - offset;
    if (
      localParts(instant, zone).slice(0, 5).join() === [y, m, d, h, min].join()
    )
      candidates.add(instant);
  }
  return [...candidates].sort((a, b) => a - b)[0];
}
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
  const [y, m, d] = localParts(after, plan.timeZone);
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

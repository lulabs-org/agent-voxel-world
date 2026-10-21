import { describe, expect, it } from 'vitest';
import {
  newPlan,
  nextOccurrence,
  validatePlan,
  wallClockInstant,
  duePlans,
  emptyTaskBook,
} from '../apps/server/src/modules/tasks';
import { DEFAULT_TASK_LIMITS, type TaskTiming } from '@voxel/shared';
const at = (s: string) => Date.parse(s);
const draft = (timing: TaskTiming, timeZone = 'Asia/Shanghai') => ({
  name: '巡查',
  goal: '巡查后结束',
  timing,
  timeZone,
  limits: DEFAULT_TASK_LIMITS,
  totalTokenBudget: 500000,
});
describe('task calendar, UTC instants and exclusive next occurrence', () => {
  it('immediate has no timer; once only has a future occurrence', () => {
    expect(
      nextOccurrence(newPlan(draft({ kind: 'immediate' }), 1000), 1000),
    ).toBeUndefined();
    const p = newPlan(draft({ kind: 'once', at: 2000 }), 1000);
    expect(nextOccurrence(p, 1999)).toBe(2000);
    expect(nextOccurrence(p, 2000)).toBeUndefined();
  });
  it('anchors intervals at creation and resumes strictly in the future', () => {
    const p = newPlan(draft({ kind: 'interval', everyMs: 60000 }), 1000);
    expect(p.nextRunAt).toBe(61000);
    expect(nextOccurrence(p, 61000)).toBe(121000);
    expect(nextOccurrence(p, 3 * 60000 + 5000)).toBe(241000);
  });
  it('computes daily and weekly in their saved timezone', () => {
    const now = at('2026-10-18T02:00:00Z');
    expect(
      newPlan(draft({ kind: 'daily', time: '09:00' }), now).nextRunAt,
    ).toBe(at('2026-10-19T01:00:00Z'));
    expect(
      newPlan(draft({ kind: 'weekly', time: '09:00', weekdays: [2, 4] }), now)
        .nextRunAt,
    ).toBe(at('2026-10-20T01:00:00Z'));
  });
  it('skips nonexistent DST time and only triggers the first repeated time', () => {
    expect(
      wallClockInstant('2026-03-08', '02:30', 'America/New_York'),
    ).toBeUndefined();
    expect(
      newPlan(
        draft({ kind: 'daily', time: '02:30' }, 'America/New_York'),
        at('2026-03-08T00:00:00Z'),
      ).nextRunAt,
    ).toBe(at('2026-03-09T06:30:00Z'));
    expect(wallClockInstant('2026-11-01', '01:30', 'America/New_York')).toBe(
      at('2026-11-01T05:30:00Z'),
    );
    expect(
      newPlan(
        draft({ kind: 'daily', time: '01:30' }, 'America/New_York'),
        at('2026-11-01T05:30:00Z'),
      ).nextRunAt,
    ).toBe(at('2026-11-02T06:30:00Z'));
  });
  it('handles half-hour DST transitions', () => {
    expect(
      wallClockInstant('2026-10-04', '02:15', 'Australia/Lord_Howe'),
    ).toBeUndefined();
    expect(wallClockInstant('2026-04-05', '01:45', 'Australia/Lord_Howe')).toBe(
      at('2026-04-04T14:45:00Z'),
    );
  });
  it('validates schedules, timezone and quotas without accepting model fields', () => {
    for (const patch of [
      { timeZone: 'Mars/Nowhere' },
      { timing: { kind: 'interval', everyMs: 0 } },
      { timing: { kind: 'weekly', weekdays: [], time: '09:00' } },
      { timing: { kind: 'daily', time: '25:00' } },
      { timing: { kind: 'once', at: 10 } },
      { limits: { maxTurns: 0 } },
      { totalTokenBudget: NaN },
    ])
      expect(() =>
        validatePlan({ ...draft({ kind: 'immediate' }), ...patch }, 100),
      ).toThrow();
    expect(
      validatePlan({
        ...draft({ kind: 'immediate' }),
        spentTokens: 0,
        state: 'enabled',
        permissions: { remove: true },
      }),
    ).not.toHaveProperty('permissions');
  });
  it('sorts due plans by trigger then insertion order for equal creation times', () => {
    const book = emptyTaskBook();
    const a = newPlan(draft({ kind: 'once', at: 20 }), 1),
      b = newPlan(draft({ kind: 'once', at: 20 }), 1),
      c = newPlan(draft({ kind: 'once', at: 10 }), 2);
    book.plans = [a, b, c];
    expect(duePlans(book, 20).map((p) => p.id)).toEqual([c.id, a.id, b.id]);
  });
});

it('defaults old limits to enabled and persists an explicit unchecked setting', () => {
  expect(validatePlan(draft({ kind: 'immediate' })).limits.enabled).toBe(true);
  const input = {
    ...draft({ kind: 'immediate' }),
    limits: { ...DEFAULT_TASK_LIMITS, enabled: false },
  };
  expect(validatePlan(JSON.parse(JSON.stringify(input))).limits.enabled).toBe(
    false,
  );
  expect(() =>
    validatePlan({ ...input, limits: { ...input.limits, enabled: 'false' } }),
  ).toThrow('开关');
});

it('ignores invalid hidden quota fields only when limits are disabled', () => {
  const input = {
    ...draft({ kind: 'immediate' }),
    limits: { enabled: false, maxTurns: null, tokenBudget: -1 },
    totalTokenBudget: null,
  };
  expect(validatePlan(input)).toMatchObject({
    limits: { ...DEFAULT_TASK_LIMITS, enabled: false },
    totalTokenBudget: 500000,
  });
  expect(() =>
    validatePlan({ ...input, limits: { ...input.limits, enabled: true } }),
  ).toThrow();
});

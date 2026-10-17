import type { TaskPlan, TaskRun } from '@voxel/shared';
export const runEnded = (run: TaskRun) =>
  ['completed', 'cancelled', 'skipped', 'missed'].includes(run.status);
export const runStatus: Record<TaskRun['status'], string> = {
  running: '执行中',
  waiting: '等待条件',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已结束',
  needs_input: '等待补充信息',
  blocked: '执行受阻',
  budget: '额度用尽',
  failed: '执行异常',
  missed: '已错过',
  skipped: '已跳过',
};
export const planStatus: Record<TaskPlan['state'], string> = {
  enabled: '已启用',
  paused: '计划暂停',
  completed: '一次性安排已结束',
  archived: '已归档',
};
export function planTime(at: number | undefined, zone: string) {
  return at
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: zone,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        year: 'numeric',
        hourCycle: 'h23',
      }).format(at)
    : '—';
}
export function timingLabel(plan: TaskPlan) {
  const t = plan.timing;
  switch (t.kind) {
    case 'immediate':
      return '立即执行 · 一次性';
    case 'once':
      return `${planTime(t.at, plan.timeZone)} · 一次性`;
    case 'interval':
      return `每 ${t.everyMs % 3600000 === 0 ? `${t.everyMs / 3600000} 小时` : `${t.everyMs / 60000} 分钟`}`;
    case 'daily':
      return `每天 ${t.time}`;
    case 'weekly':
      return `每周 ${t.weekdays.map((d) => '日一二三四五六'[d]).join('、')} ${t.time}`;
  }
}

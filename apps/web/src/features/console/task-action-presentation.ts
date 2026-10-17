import type { TaskRun } from '@voxel/shared';

type RecordedAction = NonNullable<TaskRun['actions']>[number];
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export function presentAction(entry: RecordedAction) {
  let raw = entry.detail;
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(entry.detail);
    data = object(parsed);
    raw = JSON.stringify(parsed, null, 2);
  } catch {
    // Older records may contain plain text; keep it available for inspection.
  }
  const action = object(data.action);
  const result = object(data.result);
  const title =
    (
      {
        wait: '等待',
        move: '移动',
        move_to: '前往',
        chat: '发送消息',
        edit: action.material === null ? '拆除方块' : '放置方块',
        house: '建造房屋',
        build: '批量建造',
        observe: '观察',
      } as Record<string, string>
    )[entry.kind] ?? entry.kind;
  const parts: string[] = [];
  if (entry.kind === 'move') {
    const x = number(action.x),
      z = number(action.z),
      duration = number(action.durationMs);
    if (x !== undefined && z !== undefined) {
      const direction = [
        x ? `${x > 0 ? '+' : '−'}X` : '',
        z ? `${z > 0 ? '+' : '−'}Z` : '',
      ]
        .filter(Boolean)
        .join(' / ');
      parts.push(direction ? `方向 ${direction}` : '原地');
    }
    if (action.jump === true) parts.push('跳跃');
    if (duration !== undefined) parts.push(`${duration / 1000} 秒`);
  } else if (['edit', 'house', 'move_to'].includes(entry.kind)) {
    if ([action.x, action.y, action.z].every((v) => number(v) !== undefined))
      parts.push(`位置 (${action.x}, ${action.y}, ${action.z})`);
    if (typeof action.material === 'string')
      parts.push(`材质 ${action.material}`);
  } else if (entry.kind === 'build' && Array.isArray(action.blocks)) {
    parts.push(`${action.blocks.length} 个方块操作`);
  }
  const feedback = [result.error, result.note]
    .filter((v): v is string => typeof v === 'string' && !!v.trim())
    .join(' · ');
  const status =
    entry.status === 'succeeded' && entry.kind === 'move'
      ? '指令已发送'
      : ((
          {
            pending: '未开始',
            executing: '执行中',
            succeeded: '执行成功',
            failed: '失败',
            interrupted: '已中断',
            unknown: '结果待确认',
          } as Record<string, string>
        )[entry.status] ?? entry.status);
  const tone =
    entry.status === 'succeeded'
      ? 'success'
      : entry.status === 'failed'
        ? 'error'
        : ['interrupted', 'unknown'].includes(entry.status)
          ? 'warning'
          : 'neutral';
  return { title, summary: parts.join(' · '), feedback, status, tone, raw };
}

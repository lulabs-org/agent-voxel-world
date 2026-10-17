import { describe, expect, it } from 'vitest';
import { presentAction } from './task-action-presentation';

const entry = {
  call: 7,
  index: 0,
  kind: 'move',
  status: 'succeeded',
  detail: '',
};
describe('task action presentation', () => {
  it('distinguishes a sent movement command from arrival', () => {
    const view = presentAction({
      ...entry,
      detail: JSON.stringify({
        action: { type: 'move', x: -1, z: -1, jump: false, durationMs: 800 },
        result: {
          ok: true,
          note: '移动输入已发送；是否到达需由下一轮位置确认。',
        },
      }),
    });
    expect(view.summary).toBe('方向 −X / −Z · 0.8 秒');
    expect(view.status).toBe('指令已发送');
    expect(view.feedback).toContain('是否到达需由下一轮位置确认');
  });
  it('shows removal failures and preserves their explanation', () => {
    const view = presentAction({
      ...entry,
      kind: 'edit',
      status: 'failed',
      detail: JSON.stringify({
        action: { x: 0, y: 1, z: 2, material: null },
        result: { ok: false, error: '没有拆除权限' },
      }),
    });
    expect(view.title).toBe('拆除方块');
    expect(view.summary).toBe('位置 (0, 1, 2)');
    expect(view.feedback).toBe('没有拆除权限');
    expect(view.tone).toBe('error');
  });
  it.each(['not JSON', 'null', '[]', '{"action":null,"result":42}'])(
    'tolerates legacy or malformed details: %s',
    (detail) => {
      const view = presentAction({ ...entry, detail });
      expect(view.summary).toBe('');
      expect(view.feedback).toBe('');
      expect(view.raw).toBeTruthy();
    },
  );
});

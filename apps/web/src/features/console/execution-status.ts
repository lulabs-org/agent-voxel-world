import type { AICharacterTaskStatus } from '@voxel/shared';
import { i18n } from '../../i18n';

const fallbackNames: Record<AICharacterTaskStatus, string> = {
  running: '执行任务',
  waiting: '等待环境变化',
  needs_input: '等待你的答复',
  blocked: '任务受阻',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
  budget: '额度用尽 · 已暂停',
};

export const taskStatusNames: Record<AICharacterTaskStatus, string> = new Proxy(
  {} as Record<AICharacterTaskStatus, string>,
  {
    get(_target, prop: string) {
      const status = prop as AICharacterTaskStatus;
      return i18n.t(`console.taskStatus.${status}`) || fallbackNames[status] || status;
    },
  },
);

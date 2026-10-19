import { TaskService } from '../task/service';
import { agentPermissions } from '@voxel/shared';
import { navigate, observeNavigation } from '../actions/navigation/controller';
import { parseAction } from '../actions/parse';
import type { AgentConfig, AgentSession } from '../contracts';
import type { AgentRunState } from '../task/state';
import type { AgentAttention } from './attention';
type FollowOptions = {
  memory: AgentRunState;
  session: AgentSession;
  signal: AbortSignal;
  config: AgentConfig;
  attention?: AgentAttention;
  checkpoint?: () => void | Promise<void>;
};

/** A bounded host tick: no model request, no new task, no replayed movement inputs. */
export async function runFollowStep(options: FollowOptions) {
  const { memory, session, signal, config, attention } = options;
  const follow = memory.follow,
    task = memory.task;
  if (!follow || !task || follow.taskStartedAt !== task.startedAt) {
    delete memory.follow;
    return;
  }
  const service = new TaskService(memory);
  const lease = service.lease();
  const started = Date.now();
  const remaining = (config.taskTimeoutMs ?? 900000) - task.elapsedMs;
  const controller = new AbortController();
  const timer = Number.isFinite(remaining)
    ? setTimeout(() => controller.abort(), Math.max(1, remaining))
    : undefined;
  const active = AbortSignal.any([signal, controller.signal]);
  try {
    // Revalidate persisted intent and current permission before every slice.
    parseAction(follow.action, agentPermissions(config));
    await options.checkpoint?.();
    const observation = await observeNavigation(session, active);
    active.throwIfAborted();
    const result = await navigate(session, follow.action, observation, active, {
      durationMs: 1500,
      follow,
      shouldYield: () => !!attention?.pending,
    });
    service.assertCurrent(lease);
    follow.lastResult = result;
    const moved = Math.hypot(
      result.position.x - observation.self.x,
      result.position.y - observation.self.y,
      result.position.z - observation.self.z,
    );
    follow.stalledSlices =
      result.status === 'progress' && moved < 0.08 && !attention?.pending
        ? (follow.stalledSlices ?? 0) + 1
        : 0;
    if (follow.stalledSlices >= 3) {
      result.ok = false;
      result.status = 'failed';
      result.code = 'stalled';
      result.note = '连续三次跟随没有移动进展，已停止。';
    }
    task.summary = result.note;
    task.reason = result.code ?? '';
    if (!result.ok && result.code !== 'target_not_visible') {
      task.status = 'blocked';
    } else {
      task.status = 'waiting';
      task.waitFor = 'players';
    }
    memory.noProgress = 0;
  } catch (error) {
    if (!signal.aborted && service.current(lease)) {
      task.status = controller.signal.aborted ? 'budget' : 'blocked';
      task.reason = controller.signal.aborted
        ? '跟随任务执行时间预算已耗尽。'
        : error instanceof Error
          ? error.message
          : '跟随执行失败，已停止。';
    }
  } finally {
    clearTimeout(timer);
    session.move(0, 0, false);
    if (!service.current(lease)) return;
    task.elapsedMs += Date.now() - started;
    if (task.elapsedMs >= (config.taskTimeoutMs ?? 900000) && !signal.aborted) {
      task.status = 'budget';
      task.reason = '跟随任务执行时间预算已耗尽。';
    }
    await options.checkpoint?.();
  }
}

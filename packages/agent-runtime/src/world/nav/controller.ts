import { setTimeout as pause } from 'node:timers/promises';
import { distance, key, type Vec3 } from '@voxel/shared';
import type {
  AgentAction,
  NavigationResult,
  Observation,
} from '../../contracts';
import type { AgentSession } from '../session/port';
import { arrived } from '../observe/verify';
import { collisionMap } from './map';
import { findPath, steering, type Waypoint } from './astar';

export type NavigationAction = Extract<
  AgentAction,
  { type: 'goto' | 'follow' }
>;
export type NavigationOptions = {
  durationMs?: number;
  shouldYield?: () => boolean;
  /** Hysteresis is persisted across bounded follow slices. */
  follow?: { pursuing: boolean };
};

/** Every movement is verified from authoritative observations; no predicted arrival. */
export async function navigate(
  session: Pick<AgentSession, 'move' | 'request'>,
  action: NavigationAction,
  initial: Observation,
  signal: AbortSignal,
  options: NavigationOptions = {},
): Promise<NavigationResult> {
  let o = initial,
    target: Vec3 | undefined,
    replans = 0;
  let path: Waypoint[] = [],
    plannedTarget: Vec3 | undefined,
    revision = -1;
  let waypoint: Waypoint | undefined, from: Vec3 | undefined;
  let jumpSent = false,
    lastProgress = Date.now(),
    lastPosition = { ...o.self };
  let settled = 0;
  const blocked = new Set<string>();
  const started = Date.now(),
    duration = options.durationMs ?? (action.type === 'follow' ? 1000 : 30000);
  const result = (
    status: NavigationResult['status'],
    note: string,
    code?: NavigationResult['code'],
  ): NavigationResult => ({
    ok: status !== 'failed',
    status,
    note,
    code,
    position: { x: o.self.x, y: o.self.y, z: o.self.z },
    target,
    replans,
  });
  try {
    while (Date.now() - started < duration) {
      signal.throwIfAborted();
      if (options.shouldYield?.())
        return result('progress', '收到新消息，停止导航并保留任务。');
      const map = collisionMap(o);
      if (!map)
        return result(
          'failed',
          '缺少完整局部地图或物理状态，停止导航。',
          'map_unavailable',
        );
      if (action.type === 'follow') {
        const player = o.players.find(
          (p) => p.id === action.playerId && p.connected && p.id !== o.self.id,
        );
        if (!player)
          return result(
            'failed',
            '跟随目标不在当前视野内，已停止。',
            'target_not_visible',
          );
        target = { x: player.x, y: player.y, z: player.z };
        const near = arrived(o, target, action.distance);
        const hold =
          options.follow &&
          !options.follow.pursuing &&
          arrived(o, target, action.distance + 0.6);
        if (near || hold) {
          if (options.follow) options.follow.pursuing = false;
          return result('following', '已保持跟随距离，继续监测目标。');
        }
        if (options.follow) options.follow.pursuing = true;
      } else target = { x: action.x, y: action.y, z: action.z };
      if (arrived(o, target)) {
        session.move(0, 0, false);
        if (++settled >= 2)
          return result('arrived', '已从连续位置观察确认到达。');
      } else {
        settled = 0;
        if (
          !plannedTarget ||
          distance(target, plannedTarget) > 0.6 ||
          revision !== o.revision ||
          (!waypoint && !path.length)
        ) {
          // Only plan from a stable stance; jumping/falling is allowed to settle first.
          if (o.motion!.grounded) {
            const dest = map.node(target);
            if (
              action.type === 'goto' &&
              map.known({ x: dest.x, y: Math.floor(dest.y), z: dest.z }) &&
              (!map.stand(dest) || !map.clear(target))
            )
              return result(
                'failed',
                '目标位置没有可站立空间。',
                'target_blocked',
              );
            const plan = await findPath(
              map,
              o.self,
              target,
              signal,
              blocked,
              action.type === 'follow' ? action.distance - 0.1 : 0,
            );
            if (plan.code)
              return result(
                'failed',
                '已知局部地图中没有可行路径。',
                plan.code,
              );
            path = plan.path;
            const source = map.node(o.self);
            if (Math.hypot(source.x - o.self.x, source.z - o.self.z) > 0.12)
              path.unshift({ ...source, jump: false });
            if (!plan.partial && action.type === 'goto')
              path.push({ ...target, jump: false });
            waypoint = undefined;
            plannedTarget = { ...target };
            revision = o.revision;
          }
        }
        if (!waypoint && path.length) {
          waypoint = path.shift()!;
          from = map.node(o.self);
          jumpSent = false;
        }
        if (waypoint) {
          if (arrived(o, waypoint, 0.1)) {
            waypoint = undefined;
            session.move(0, 0, false);
          } else {
            const jump = waypoint.jump && !jumpSent && !!o.motion?.grounded;
            if (jump) jumpSent = true;
            session.move(...movement(o.self, waypoint), jump);
          }
        } else session.move(0, 0, false);
        if (distance(o.self, lastPosition) >= 0.08) {
          lastProgress = Date.now();
          lastPosition = { ...o.self };
        } else if (Date.now() - lastProgress > 1200) {
          if (++replans > 3)
            return result('failed', '多次重新寻路后仍无法前进。', 'stalled');
          if (waypoint && from)
            blocked.add(`${key(from)}>${key(map.node(waypoint))}`);
          path = [];
          waypoint = undefined;
          plannedTarget = undefined;
          lastProgress = Date.now();
          session.move(0, 0, false);
        }
      }
      await pause(100, undefined, { signal });
      // Stop while awaiting feedback; a slow/failed observation must not leave a held input.
      session.move(0, 0, false);
      o = await observeNavigation(session, signal);
    }
    return action.type === 'follow'
      ? result('progress', '跟随已推进，下一次调度继续。')
      : result('failed', '导航超时，已停止。', 'timeout');
  } finally {
    session.move(0, 0, false);
  }
}
function movement(from: Vec3, to: Vec3): [number, number] {
  const input = steering(from, to);
  return [input.x, input.z];
}
export async function observeNavigation(
  session: Pick<AgentSession, 'request'>,
  signal: AbortSignal,
) {
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([
      session.request<Observation>('observe'),
      cancelled,
    ]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

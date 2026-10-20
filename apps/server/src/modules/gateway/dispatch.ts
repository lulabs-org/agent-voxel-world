import { randomUUID } from 'node:crypto';
import {
  GatewayError,
  isWrite,
  type RpcMethod,
  type RpcParams,
} from '@voxel/gateway-protocol';
import type { GatewayTarget } from './target';
import type { CommandRouter } from './command-router';

export type DispatchGateway = GatewayTarget & {
  commands: CommandRouter;
};

/** RPC command boundary. HTTP adapters belong to their respective domains. */
export async function invokeGateway(
  g: DispatchGateway,
  method: RpcMethod,
  p: RpcParams,
  id?: string,
): Promise<unknown> {
  const originalParams = { ...p };
  p = { ...p };
  const resolveTarget = () => {
    if (
      ['plans.get', 'plans.update', 'plans.control', 'plans.reassign'].includes(
        method,
      )
    ) {
      const plan = g.plans.get(p.planId!);
      if (
        originalParams.characterId &&
        plan.characterId !== originalParams.characterId
      )
        throw new GatewayError('计划执行角色已改变。', 'CONFLICT', 409);
      p.characterId = plan.characterId;
      if (['plans.update', 'plans.control', 'plans.reassign'].includes(method))
        g.plans.assertRevision(plan.id, p.expectedPlanRevision);
    }
    if (method === 'runs.control') {
      const run = g.plans.run(p.runId!);
      if (
        originalParams.characterId &&
        run.characterId !== originalParams.characterId
      )
        throw new GatewayError('执行角色不匹配。', 'CONFLICT', 409);
      p.characterId = run.characterId;
    }
  };
  const view = () =>
    g.publicList().map((a) => ({
      ...a,
      resourceVersion: g.events.version,
      taskIdentity: g.publicIdentity(a.id) ?? null,
    }));
  const validateRevision = () => {
    resolveTarget();
    if (
      method === 'runs.control' ||
      (method === 'plans.control' && p.operation === 'run')
    ) {
      if (p.expectedTask === undefined)
        throw new GatewayError(
          '缺少当前任务修订，请刷新后重试。',
          'CONFLICT',
          409,
        );
      const current = g.taskIdentity(p.characterId!) ?? null;
      if (
        p.expectedTask === null
          ? current !== null
          : !current ||
            p.expectedTask.id !== current.id ||
            p.expectedTask.revision !== current.revision ||
            p.expectedTask.startedAt !== current.startedAt
      )
        throw new GatewayError('任务已改变，请刷新后重试。', 'CONFLICT', 409);
    }
  };
  const execute = async () => {
    validateRevision();
    const since = g.storageRevision;
    if (isWrite(method))
      g.assertWritable(
        ['characters.stop', 'characters.delete'].includes(method)
          ? undefined
          : p.characterId,
      );
    const value = p.value ?? {};
    let result: unknown;
    switch (method) {
      case 'gateway.status':
        return { version: 2, resourceVersion: g.events.version };
      case 'commands.get':
        return g.commands.get(p.commandId ?? '');
      case 'characters.list':
        return view();
      case 'characters.get': {
        const a = view().find((a) => a.id === p.characterId);
        if (!a) throw new GatewayError('Agent 不存在。', 'NOT_FOUND', 404);
        return a;
      }
      case 'characters.create':
        result = g.create(value);
        break;
      case 'characters.update':
        result = await g.update(p.characterId!, value);
        break;
      case 'characters.join':
        result = g.join(p.characterId!);
        break;
      case 'characters.stop':
        result = g.stop(p.characterId!);
        await g.settled(p.characterId!);
        break;
      case 'characters.delete':
        result = await g.remove(p.characterId!);
        break;
      case 'characters.voice':
        result = await g.setVoice(p.characterId!, value);
        break;
      case 'plans.list':
        return g.tasks.planPage(p);
      case 'plans.get':
        return g.tasks.publicPlan(p.planId!);
      case 'plans.reassign':
        result = await g.tasks.reassignPlan(p.planId!, p.targetCharacterId!);
        break;
      case 'plans.create':
        result = await g.tasks.createTaskPlan(p.characterId!, {
          ...value,
          requestId: value.requestId ?? id,
        });
        break;
      case 'plans.update':
        result = await g.tasks.updateTaskPlan(p.characterId, p.planId!, value);
        break;
      case 'plans.control':
        result = await g.tasks.controlTaskPlan(
          p.characterId,
          p.planId!,
          p.operation!,
          {
            ...value,
            requestId: value.requestId ?? id,
          },
        );
        break;
      case 'runs.list':
        return g.tasks.publicRuns(p.characterId!, p.planId!, p.offset, true);
      case 'runs.control':
        result = await g.tasks.controlTaskRun(
          p.characterId!,
          p.runId!,
          p.operation!,
          value,
        );
        break;
      case 'providers.list':
        return g.providers.list();
      case 'providers.models':
        return { models: await g.models(p.providerId!) };
      case 'providers.save':
        result = await g.providers.save(value, p.providerId);
        g.events.publish('providers');
        break;
      case 'providers.delete':
        result = await g.removeProvider(p.providerId!);
        g.events.publish('providers');
        break;
      default:
        throw new GatewayError('此方法由连接管理器处理。');
    }
    await g.flush(since);
    if (
      result &&
      typeof result === 'object' &&
      'id' in result &&
      method.startsWith('characters.')
    ) {
      return {
        ...result,
        resourceVersion: g.events.version,
        taskIdentity: g.publicIdentity(String(result.id)) ?? null,
      };
    }
    return result ?? null;
  };
  if (!isWrite(method)) return execute();
  const {
    expectedTask: _expected,
    expectedPlanRevision: _plan,
    ...commandParams
  } = originalParams;
  if (
    [
      'plans.update',
      'plans.control',
      'plans.reassign',
      'runs.control',
    ].includes(method)
  )
    delete commandParams.characterId;
  return g.commands.run(
    id ?? randomUUID(),
    { method, params: commandParams },
    method.startsWith('plans.') || method === 'characters.delete'
      ? 'plans'
      : (p.characterId ?? 'registry'),
    execute,
    () => {
      validateRevision();
      if (
        p.characterId &&
        (['characters.stop', 'characters.delete'].includes(method) ||
          (method === 'runs.control' &&
            ['pause', 'cancel'].includes(p.operation ?? '') &&
            g.currentRunId(p.characterId) === p.runId))
      )
        g.interrupt(p.characterId);
    },
  );
}

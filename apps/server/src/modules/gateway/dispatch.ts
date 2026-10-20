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
  legacy = false,
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
      if (originalParams.agentId && plan.agentId !== originalParams.agentId)
        throw new GatewayError('计划执行角色已改变。', 'CONFLICT', 409);
      p.agentId = plan.agentId;
      if (
        !legacy &&
        ['plans.update', 'plans.control', 'plans.reassign'].includes(method)
      )
        g.plans.assertRevision(plan.id, p.expectedPlanRevision);
    }
    if (method === 'runs.control') {
      const run = g.plans.run(p.runId!);
      if (originalParams.agentId && run.agentId !== originalParams.agentId)
        throw new GatewayError('执行角色不匹配。', 'CONFLICT', 409);
      p.agentId = run.agentId;
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
      !legacy &&
      (method === 'runs.control' ||
        (method === 'plans.control' && p.operation === 'run'))
    ) {
      if (p.expectedTask === undefined)
        throw new GatewayError(
          '缺少当前任务修订，请刷新后重试。',
          'CONFLICT',
          409,
        );
      const current = g.taskIdentity(p.agentId!) ?? null;
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
        ['agents.stop', 'agents.delete'].includes(method)
          ? undefined
          : p.agentId,
      );
    const value = p.value ?? {};
    let result: unknown;
    switch (method) {
      case 'gateway.status':
        return { version: 1, resourceVersion: g.events.version };
      case 'commands.get':
        return g.commands.get(p.commandId ?? '');
      case 'agents.list':
        return legacy ? g.publicList() : view();
      case 'agents.get': {
        const a = view().find((a) => a.id === p.agentId);
        if (!a) throw new GatewayError('Agent 不存在。', 'NOT_FOUND', 404);
        return a;
      }
      case 'agents.create':
        result = g.create(value);
        break;
      case 'agents.update':
        result = await g.update(p.agentId!, value);
        break;
      case 'agents.join':
        result = g.join(p.agentId!);
        break;
      case 'agents.stop':
        result = g.stop(p.agentId!);
        await g.settled(p.agentId!);
        break;
      case 'agents.delete':
        result = await g.remove(p.agentId!);
        break;
      case 'agents.voice':
        result = await g.setVoice(p.agentId!, value);
        break;
      case 'plans.list':
        return legacy ? g.publicPlans(p.agentId) : g.planPage(p);
      case 'plans.get':
        return g.publicPlan(p.planId!);
      case 'plans.reassign':
        result = await g.reassignPlan(p.planId!, p.targetAgentId!);
        break;
      case 'plans.create':
        result = await g.createTaskPlan(p.agentId!, {
          ...value,
          requestId: value.requestId ?? id,
        });
        break;
      case 'plans.update':
        result = await g.updateTaskPlan(p.agentId, p.planId!, value);
        break;
      case 'plans.control':
        result = await g.controlTaskPlan(p.agentId, p.planId!, p.operation!, {
          ...value,
          requestId: value.requestId ?? id,
        });
        break;
      case 'runs.list':
        return g.publicRuns(p.agentId!, p.planId!, p.offset, !legacy);
      case 'runs.control':
        result = await g.controlTaskRun(
          p.agentId!,
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
      !legacy &&
      result &&
      typeof result === 'object' &&
      'id' in result &&
      method.startsWith('agents.')
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
    delete commandParams.agentId;
  return g.commands.run(
    id ?? randomUUID(),
    { method, params: commandParams },
    method.startsWith('plans.') || method === 'agents.delete'
      ? 'plans'
      : (p.agentId ?? 'registry'),
    execute,
    () => {
      validateRevision();
      if (
        p.agentId &&
        (['agents.stop', 'agents.delete'].includes(method) ||
          (method === 'runs.control' &&
            ['pause', 'cancel'].includes(p.operation ?? '') &&
            g.currentRunId(p.agentId) === p.runId))
      )
        g.interrupt(p.agentId);
    },
  );
}

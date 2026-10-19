import { randomUUID } from 'node:crypto';
import {
  GatewayError,
  isWrite,
  type RpcMethod,
  type RpcParams,
} from '@voxel/gateway-protocol';
import type { AgentGateway } from './gateway';
/** Both legacy HTTP and RPC use this command boundary. Internal player authority stays separate. */
export async function invokeGateway(
  g: AgentGateway,
  method: RpcMethod,
  p: RpcParams,
  id?: string,
  legacy = false,
): Promise<unknown> {
  const view = () =>
    g.publicList().map((a) => ({
      ...a,
      resourceVersion: g.events.version,
      taskIdentity: g.publicIdentity(a.id) ?? null,
    }));
  const validateRevision = () => {
    if (
      !legacy &&
      (method.startsWith('tasks.') ||
        method === 'runs.control' ||
        (method === 'plans.control' &&
          ['run', 'resume'].includes(p.operation ?? '')))
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
        [
          'tasks.pause',
          'tasks.cancel',
          'agents.stop',
          'agents.delete',
        ].includes(method)
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
      case 'tasks.assign':
        result = await g.assignTask(p.agentId!, value);
        break;
      case 'tasks.pause':
      case 'tasks.cancel':
        result = await g.controlTask(
          p.agentId!,
          method === 'tasks.pause' ? 'pause' : 'cancel',
        );
        break;
      case 'tasks.resume':
        result = g.resume(p.agentId!, value);
        break;
      case 'plans.list':
        return g.publicPlans(p.agentId!, !legacy);
      case 'plans.create':
        result = await g.createTaskPlan(p.agentId!, {
          ...value,
          requestId: value.requestId ?? id,
        });
        break;
      case 'plans.update':
        result = await g.updateTaskPlan(p.agentId!, p.planId!, value);
        break;
      case 'plans.control':
        result = await g.controlTaskPlan(p.agentId!, p.planId!, p.operation!, {
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
      (method.startsWith('agents.') || method.startsWith('tasks.'))
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
  const { expectedTask: _expected, ...commandParams } = p;
  return g.commands.run(
    id ?? randomUUID(),
    { method, params: commandParams },
    p.agentId ?? 'registry',
    execute,
    () => {
      validateRevision();
      if (
        p.agentId &&
        ([
          'tasks.pause',
          'tasks.cancel',
          'agents.stop',
          'agents.delete',
        ].includes(method) ||
          (method === 'runs.control' &&
            ['pause', 'cancel'].includes(p.operation ?? '') &&
            g.currentRunId(p.agentId) === p.runId))
      )
        g.interrupt(p.agentId);
    },
  );
}

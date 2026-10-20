import type { AICharacterView, TaskPlan, TaskRun } from '@voxel/shared';
/** Browser-safe control protocol. World/player identity never comes from these frames. */
export const PROTOCOL_VERSION = 2;
export const MAX_REQUEST_BYTES = 32768;
export const methods = [
  'gateway.status',
  'gateway.subscribe',
  'gateway.unsubscribe',
  'commands.get',
  'characters.list',
  'characters.get',
  'characters.create',
  'characters.update',
  'characters.join',
  'characters.stop',
  'characters.delete',
  'characters.voice',
  'plans.list',
  'plans.get',
  'plans.reassign',
  'plans.create',
  'plans.update',
  'plans.control',
  'runs.list',
  'runs.control',
  'providers.list',
  'providers.save',
  'providers.delete',
  'providers.models',
] as const;
export type RpcMethod = (typeof methods)[number];
export type TaskIdentity = { id: string; revision: number; startedAt: number };
export type ResourceMetadata = {
  resourceVersion: number;
  taskIdentity: TaskIdentity | null;
};
export type PublicAICharacterView = AICharacterView & ResourceMetadata;
export type PublicPlanView = TaskPlan & ResourceMetadata;
export type PublicRunView = TaskRun & ResourceMetadata;
export type CommandReceipt = {
  state: 'pending' | 'committed' | 'rejected' | 'unknown';
  result?: unknown;
  error?: RpcErrorData;
};
export type RpcParams = {
  characterId?: string;
  planId?: string;
  runId?: string;
  providerId?: string;
  offset?: number;
  search?: string;
  state?: 'enabled' | 'paused' | 'completed' | 'archived' | 'unassigned';
  timing?: import('@voxel/shared').TaskTiming['kind'];
  expectedPlanRevision?: number;
  targetCharacterId?: string;
  operation?: string;
  value?: Record<string, unknown>;
  expectedTask?: TaskIdentity | null;
  commandId?: string;
  scope?: 'all' | 'characters' | 'character' | 'plans' | 'runs' | 'providers';
  subscriptionId?: string;
};
export type RpcRequest = {
  type: 'req';
  id: string;
  method: RpcMethod;
  params: RpcParams;
  commandId?: string;
};
export type Connect = {
  type: 'connect';
  version: 2;
  client: 'web' | 'cli';
  token: string;
};
export type RpcErrorData = { code: string; message: string; status: number };
export type GatewayEvent = {
  type: 'event';
  subscriptionId: string;
  seq: number;
  event: 'snapshot' | 'changed' | 'shutdown';
  data: unknown;
};
export type ServerFrame =
  | {
      type: 'connected';
      version: 2;
      gatewayEpoch: string;
      capabilities: readonly string[];
    }
  | { type: 'res'; id: string; ok: true; result: unknown }
  | { type: 'res'; id: string; ok: false; error: RpcErrorData }
  | GatewayEvent
  | { type: 'error'; error: RpcErrorData };
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code = 'INVALID_REQUEST',
    readonly status = 400,
  ) {
    super(message);
  }
}
export function isWrite(method: RpcMethod) {
  return ![
    'gateway.status',
    'gateway.subscribe',
    'gateway.unsubscribe',
    'commands.get',
    'characters.list',
    'characters.get',
    'plans.list',
    'plans.get',
    'runs.list',
    'providers.list',
    'providers.models',
  ].includes(method);
}
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}
export function parseConnect(value: unknown): Connect {
  if (
    !record(value) ||
    value.type !== 'connect' ||
    value.version !== PROTOCOL_VERSION ||
    !['web', 'cli'].includes(String(value.client)) ||
    typeof value.token !== 'string' ||
    value.token.length > 4096
  )
    throw new GatewayError('网关握手或协议版本无效。', 'BAD_HANDSHAKE');
  return value as Connect;
}
export function parseRequest(value: unknown): RpcRequest {
  if (
    !record(value) ||
    value.type !== 'req' ||
    !identifier(value.id) ||
    !methods.includes(value.method as RpcMethod) ||
    !record(value.params)
  )
    throw new GatewayError('网关请求格式无效。');
  const r = value as RpcRequest,
    p = r.params;
  const permitted = [
    'characterId',
    'planId',
    'runId',
    'providerId',
    'offset',
    'search',
    'state',
    'timing',
    'expectedPlanRevision',
    'targetCharacterId',
    'operation',
    'value',
    'expectedTask',
    'commandId',
    'scope',
    'subscriptionId',
  ];
  if (Object.keys(p).some((k) => !permitted.includes(k)))
    throw new GatewayError('未知请求参数。');
  for (const k of [
    'characterId',
    'planId',
    'runId',
    'providerId',
    'targetCharacterId',
    'commandId',
    'subscriptionId',
  ] as const)
    if (p[k] !== undefined && !identifier(p[k]))
      throw new GatewayError('资源标识无效。');
  if (isWrite(r.method) && !identifier(r.commandId))
    throw new GatewayError('写操作需要稳定的 commandId。');
  if (p.value !== undefined && !record(p.value))
    throw new GatewayError('业务参数格式无效。');
  if (
    p.offset !== undefined &&
    (!Number.isSafeInteger(p.offset) || p.offset < 0)
  )
    throw new GatewayError('分页参数无效。');
  if (
    p.expectedTask !== undefined &&
    p.expectedTask !== null &&
    (!record(p.expectedTask) ||
      !identifier(p.expectedTask.id) ||
      !Number.isSafeInteger(p.expectedTask.revision) ||
      p.expectedTask.revision < 0 ||
      !Number.isFinite(p.expectedTask.startedAt))
  )
    throw new GatewayError('任务修订无效。');
  const requiredCharacter =
    r.method === 'plans.create' ||
    /^characters\.(get|update|join|stop|delete|voice)$/.test(r.method);
  if (requiredCharacter && !p.characterId)
    throw new GatewayError('缺少 Agent 标识。');
  if (
    [
      'plans.get',
      'plans.update',
      'plans.control',
      'plans.reassign',
      'runs.list',
    ].includes(r.method) &&
    !p.planId
  )
    throw new GatewayError('缺少计划标识。');
  if (r.method === 'runs.control' && !p.runId)
    throw new GatewayError('缺少执行标识。');
  if (
    ['providers.delete', 'providers.models'].includes(r.method) &&
    !p.providerId
  )
    throw new GatewayError('缺少模型服务标识。');
  if (
    r.method === 'plans.control' &&
    !['run', 'pause', 'resume', 'archive', 'extend'].includes(p.operation ?? '')
  )
    throw new GatewayError('计划操作无效。');
  if (
    r.method === 'runs.control' &&
    !['pause', 'resume', 'cancel'].includes(p.operation ?? '')
  )
    throw new GatewayError('执行操作无效。');
  if (
    r.method === 'gateway.subscribe' &&
    (!['all', 'characters', 'character', 'plans', 'runs', 'providers'].includes(
      p.scope ?? 'all',
    ) ||
      (p.scope === 'character' && !p.characterId))
  )
    throw new GatewayError('订阅范围无效。');
  if (r.method === 'gateway.subscribe' && p.scope === 'runs' && !p.planId)
    throw new GatewayError('缺少计划标识。');
  if (r.method === 'commands.get' && !p.commandId)
    throw new GatewayError('缺少命令标识。');
  if (r.method === 'gateway.unsubscribe' && !p.subscriptionId)
    throw new GatewayError('缺少订阅标识。');
  if (
    p.search !== undefined &&
    (typeof p.search !== 'string' || p.search.length > 80)
  )
    throw new GatewayError('搜索条件无效。');
  if (
    p.state !== undefined &&
    !['enabled', 'paused', 'completed', 'archived', 'unassigned'].includes(
      p.state,
    )
  )
    throw new GatewayError('计划状态无效。');
  if (
    p.timing !== undefined &&
    !['immediate', 'once', 'interval', 'daily', 'weekly'].includes(p.timing)
  )
    throw new GatewayError('执行方式无效。');
  if (
    ['plans.update', 'plans.control', 'plans.reassign'].includes(r.method) &&
    (!Number.isSafeInteger(p.expectedPlanRevision) ||
      p.expectedPlanRevision! < 1)
  )
    throw new GatewayError('缺少计划修订。');
  if (r.method === 'plans.reassign' && !p.targetCharacterId)
    throw new GatewayError('缺少新的执行角色。');
  return r;
}
export function publicError(error: unknown): RpcErrorData {
  if (error instanceof GatewayError)
    return { code: error.code, message: error.message, status: error.status };
  const status =
    record(error) && typeof error.status === 'number' ? error.status : 500;
  return {
    code:
      status === 409
        ? 'CONFLICT'
        : status === 404
          ? 'NOT_FOUND'
          : status === 429
            ? 'BUSY'
            : status >= 500
              ? 'INTERNAL'
              : 'INVALID_REQUEST',
    message:
      status < 500 && error instanceof Error
        ? error.message
        : '操作未完成，请检查服务状态或存储权限。',
    status,
  };
}

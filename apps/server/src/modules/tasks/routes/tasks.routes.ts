import type { Express, Request } from 'express';
import type { AgentGateway } from '../../gateway/gateway';
import { createRpcBinder } from '../../gateway/bind';
import type { RpcParams } from '@voxel/gateway-protocol';

const agent = (r: Request) => ({ agentId: String(r.params.id) });
const value = (r: Request) => ({ ...agent(r), value: r.body ?? {} });
const plan = (r: Request) => ({ ...value(r), planId: String(r.params.planId) });

/**
 * 安装 Task / Plan（任务计划与运行历史）相关 HTTP REST 路由
 */
export function installTaskRoutes(app: Express, g: AgentGateway) {
  const bind = createRpcBinder(app, g);

  // ---------------------------------------------------------------------------
  // 全局任务计划与控制
  // ---------------------------------------------------------------------------

  /**
   * @openapi
   * /agents/tasks:
   *   get:
   *     summary: 获取全局任务计划列表
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: query
   *         name: state
   *         schema:
   *           type: string
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *       - in: query
   *         name: agentId
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 任务计划分页列表
   */
  bind(
    'get',
    '/agents/tasks',
    'plans.list',
    (r) => ({
      state: (r.query.state ? String(r.query.state) : undefined) as RpcParams['state'],
      offset: r.query.offset !== undefined ? Number(r.query.offset) : undefined,
      search: r.query.search ? String(r.query.search) : undefined,
      agentId: r.query.agentId ? String(r.query.agentId) : undefined,
    }),
    200,
    false,
  );

  /**
   * @openapi
   * /agents/tasks:
   *   post:
   *     summary: 创建任务计划
   *     tags:
   *       - Agents Task
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       201:
   *         description: 任务计划创建成功
   */
  bind('post', '/agents/tasks', 'plans.create', value, 201);

  /**
   * @openapi
   * /agents/tasks/{planId}:
   *   get:
   *     summary: 获取指定任务计划详情
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: path
   *         name: planId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 任务计划详情
   */
  bind('get', '/agents/tasks/:planId', 'plans.get', (r) => ({
    planId: String(r.params.planId),
  }));

  /**
   * @openapi
   * /agents/tasks/{planId}:
   *   put:
   *     summary: 更新指定任务计划
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: path
   *         name: planId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: 任务计划更新成功
   */
  bind('put', '/agents/tasks/:planId', 'plans.update', plan);

  /**
   * @openapi
   * /agents/tasks/{planId}:
   *   delete:
   *     summary: 删除指定任务计划
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: path
   *         name: planId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       204:
   *         description: 删除成功
   */
  bind(
    'delete',
    '/agents/tasks/:planId',
    'plans.control',
    (r) => ({ planId: String(r.params.planId), operation: 'delete' }),
    204,
  );

  /**
   * @openapi
   * /agents/tasks/{planId}/reassign:
   *   post:
   *     summary: 重新指派任务计划所属 Agent
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: path
   *         name: planId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: 操作成功
   */
  bind('post', '/agents/tasks/:planId/reassign', 'plans.reassign', (r) => ({
    planId: String(r.params.planId),
    targetAgentId: String(r.body?.targetAgentId ?? ''),
  }));

  /**
   * @openapi
   * /agents/tasks/{planId}/runs:
   *   get:
   *     summary: 获取任务计划的执行运行历史
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: path
   *         name: planId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: 任务运行历史记录
   */
  bind(
    'get',
    '/agents/tasks/:planId/runs',
    'runs.list',
    (r) => ({
      planId: String(r.params.planId),
      offset: Number(r.query.offset ?? 0),
    }),
    200,
    false,
  );

  /**
   * @openapi
   * /agents/tasks/{planId}/{operation}:
   *   post:
   *     summary: 控制任务计划状态
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: path
   *         name: planId
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: operation
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 操作成功
   */
  bind('post', '/agents/tasks/:planId/:operation', 'plans.control', (r) => ({
    planId: String(r.params.planId),
    operation: String(r.params.operation),
    value: r.body ?? {},
  }));

  /**
   * @openapi
   * /agents/task-runs/{runId}/{operation}:
   *   post:
   *     summary: 控制特定任务运行状态
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: path
   *         name: runId
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: operation
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 操作成功
   */
  bind('post', '/agents/task-runs/:runId/:operation', 'runs.control', (r) => ({
    runId: String(r.params.runId),
    operation: String(r.params.operation),
    value: r.body ?? {},
  }));

  // ---------------------------------------------------------------------------
  // Agent 下属特定任务计划与历史
  // ---------------------------------------------------------------------------

  /**
   * @openapi
   * /agents/{id}/tasks:
   *   get:
   *     summary: 获取 Agent 的任务计划列表
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 任务计划列表
   */
  bind('get', '/agents/:id/tasks', 'plans.list', agent);

  /**
   * @openapi
   * /agents/{id}/tasks:
   *   post:
   *     summary: 创建 Agent 任务计划
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       201:
   *         description: 任务计划创建成功
   */
  bind('post', '/agents/:id/tasks', 'plans.create', value, 201);

  /**
   * @openapi
   * /agents/{id}/tasks/{planId}:
   *   get:
   *     summary: 获取 Agent 下指定任务计划
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: planId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 任务计划详情
   */
  bind('get', '/agents/:id/tasks/:planId', 'plans.get', (r) => ({
    planId: String(r.params.planId),
  }));

  /**
   * @openapi
   * /agents/{id}/tasks/{planId}:
   *   put:
   *     summary: 更新 Agent 任务计划
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: planId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: 任务计划更新成功
   */
  bind('put', '/agents/:id/tasks/:planId', 'plans.update', plan);

  /**
   * @openapi
   * /agents/{id}/tasks/{planId}:
   *   delete:
   *     summary: 删除 Agent 任务计划
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: planId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       204:
   *         description: 删除成功
   */
  bind(
    'delete',
    '/agents/:id/tasks/:planId',
    'plans.control',
    (r) => ({ ...plan(r), operation: 'delete' }),
    204,
  );

  /**
   * @openapi
   * /agents/{id}/tasks/{planId}/runs:
   *   get:
   *     summary: 获取任务计划的执行运行历史
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: planId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           default: 0
   *     responses:
   *       200:
   *         description: 任务运行历史记录
   */
  bind('get', '/agents/:id/tasks/:planId/runs', 'runs.list', (r) => ({
    ...agent(r),
    planId: String(r.params.planId),
    offset: Number(r.query.offset ?? 0),
  }));

  /**
   * @openapi
   * /agents/{id}/tasks/{planId}/{operation}:
   *   post:
   *     summary: 控制任务计划状态
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: planId
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: operation
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 操作成功
   */
  bind(
    'post',
    '/agents/:id/tasks/:planId/:operation',
    'plans.control',
    (r) => ({ ...plan(r), operation: String(r.params.operation) }),
  );

  /**
   * @openapi
   * /agents/{id}/task-runs/{runId}/{operation}:
   *   post:
   *     summary: 控制特定任务运行状态
   *     tags:
   *       - Agents Task
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: runId
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: operation
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 操作成功
   */
  bind(
    'post',
    '/agents/:id/task-runs/:runId/:operation',
    'runs.control',
    (r) => ({
      ...value(r),
      runId: String(r.params.runId),
      operation: String(r.params.operation),
    }),
  );
}

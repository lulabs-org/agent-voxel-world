import express, { type Express, type Request, type Response } from 'express';
import type { AgentGateway } from '@voxel/agent-gateway';
import type { AgentManager } from '../agent/manager';
import { SpeechError } from '../audio/errors';
import { installVoiceServiceRoutes } from '../audio/routes/voice-services.routes';
import { createOriginGuard } from '../../common/middleware/cors';
import { requireJsonBody } from '../../common/middleware/json-body';
import { errorHandler } from '../../common/middleware/error-handler';
import { webOrigin } from '../../config/env';
import {
  publicError,
  identifier,
  type RpcMethod,
  type RpcParams,
} from '@voxel/gateway-protocol';

/** Keep legacy paths and response bodies while using the same command dispatcher as RPC. */
export function installGatewayHttp(app: Express, g: AgentGateway) {
  const bind = (
    verb: 'get' | 'post' | 'put' | 'delete',
    path: string,
    method: RpcMethod,
    params: (req: Request) => RpcParams = () => ({}),
    status = 200,
  ) => {
    app[verb](path, (req: Request, res: Response) => {
      const key = req.header('Idempotency-Key');
      if (key !== undefined && !identifier(key)) {
        res.status(400).json({ error: 'Idempotency-Key 无效。' });
        return;
      }
      void g
        .dispatch(
          method,
          params(req),
          req.header('Idempotency-Key') || undefined,
          true,
        )
        .then(
          (result) => {
            if (status === 204) res.sendStatus(204);
            else res.status(status).json(result);
          },
          (error) => {
            const e = publicError(error);
            res.status(e.status).json({ error: e.message });
          },
        );
    });
  };

  const agent = (r: Request) => ({ agentId: String(r.params.id) }),
    value = (r: Request) => ({ ...agent(r), value: r.body ?? {} }),
    plan = (r: Request) => ({ ...value(r), planId: String(r.params.planId) });

  // ---------------------------------------------------------------------------
  // Provider 配置管理
  // ---------------------------------------------------------------------------

  /**
   * @openapi
   * /agents/providers:
   *   get:
   *     summary: 获取 LLM 模型提供商配置列表
   *     tags:
   *       - Agents Provider
   *     responses:
   *       200:
   *         description: 提供商配置列表
   */
  bind('get', '/agents/providers', 'providers.list');

  /**
   * @openapi
   * /agents/providers:
   *   post:
   *     summary: 添加 LLM 模型提供商配置
   *     tags:
   *       - Agents Provider
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       201:
   *         description: 创建成功
   */
  bind(
    'post',
    '/agents/providers',
    'providers.save',
    (r) => ({ value: r.body }),
    201,
  );

  /**
   * @openapi
   * /agents/providers/{id}:
   *   put:
   *     summary: 更新 LLM 模型提供商配置
   *     tags:
   *       - Agents Provider
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
   *       200:
   *         description: 更新成功
   */
  bind('put', '/agents/providers/:id', 'providers.save', (r) => ({
    providerId: String(r.params.id),
    value: r.body,
  }));

  /**
   * @openapi
   * /agents/providers/{id}:
   *   delete:
   *     summary: 删除 LLM 模型提供商配置
   *     tags:
   *       - Agents Provider
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       204:
   *         description: 删除成功
   */
  bind(
    'delete',
    '/agents/providers/:id',
    'providers.delete',
    (r) => ({ providerId: String(r.params.id) }),
    204,
  );

  /**
   * @openapi
   * /agents/providers/{id}/models:
   *   get:
   *     summary: 获取指定提供商下的可用模型列表
   *     tags:
   *       - Agents Provider
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 可用模型列表
   */
  bind('get', '/agents/providers/:id/models', 'providers.models', (r) => ({
    providerId: String(r.params.id),
  }));

  // ---------------------------------------------------------------------------
  // Agent 基础与生命周期
  // ---------------------------------------------------------------------------

  /**
   * @openapi
   * /agents:
   *   get:
   *     summary: 获取所有 Agent 列表
   *     tags:
   *       - Agents
   *     responses:
   *       200:
   *         description: Agent 列表
   */
  bind('get', '/agents', 'agents.list');

  /**
   * @openapi
   * /agents:
   *   post:
   *     summary: 创建新 Agent
   *     tags:
   *       - Agents
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       201:
   *         description: Agent 创建成功
   */
  bind('post', '/agents', 'agents.create', (r) => ({ value: r.body }), 201);

  /**
   * @openapi
   * /agents/{id}:
   *   put:
   *     summary: 更新 Agent 信息与配置
   *     tags:
   *       - Agents
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
   *       200:
   *         description: 更新成功
   */
  bind('put', '/agents/:id', 'agents.update', value);

  /**
   * @openapi
   * /agents/{id}:
   *   delete:
   *     summary: 停止并删除 Agent、任务计划和运行记录（保留世界建筑和共享服务）
   *     tags: [Agents]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       204:
   *         description: 删除已持久化
   *       404:
   *         description: Agent 不存在
   *       409:
   *         description: Agent 正在更新
   */
  bind('delete', '/agents/:id', 'agents.delete', agent, 204);

  /**
   * @openapi
   * /agents/{id}/join:
   *   post:
   *     summary: 让 Agent 加入游戏世界房间
   *     tags:
   *       - Agents
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 加入成功
   */
  bind('post', '/agents/:id/join', 'agents.join', agent);

  /**
   * @openapi
   * /agents/{id}/stop:
   *   post:
   *     summary: 停止 Agent 并移出世界
   *     tags:
   *       - Agents
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 停止成功
   */
  bind('post', '/agents/:id/stop', 'agents.stop', agent);

  /**
   * @openapi
   * /agents/{id}/voice:
   *   post:
   *     summary: 配置 Agent 音色与发音服务
   *     tags:
   *       - Agents
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
   *       200:
   *         description: 音色设置成功
   */
  bind('post', '/agents/:id/voice', 'agents.voice', value);

  // ---------------------------------------------------------------------------
  // Agent 任务控制与即时任务
  // ---------------------------------------------------------------------------

  /**
   * @openapi
   * /agents/{id}/pause:
   *   post:
   *     summary: 暂停 Agent 当前任务
   *     tags:
   *       - Agents
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 操作成功
   */
  bind('post', '/agents/:id/pause', 'tasks.pause', agent);

  /**
   * @openapi
   * /agents/{id}/resume:
   *   post:
   *     summary: 恢复 Agent 运行
   *     tags:
   *       - Agents
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: 恢复成功
   */
  bind('post', '/agents/:id/resume', 'tasks.resume', value);

  /**
   * @openapi
   * /agents/{id}/cancel:
   *   post:
   *     summary: 取消 Agent 当前任务
   *     tags:
   *       - Agents
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 操作成功
   */
  bind('post', '/agents/:id/cancel', 'tasks.cancel', agent);

  /**
   * @openapi
   * /agents/{id}/task:
   *   post:
   *     summary: 为 Agent 分配即时任务
   *     tags:
   *       - Agents
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
   *       200:
   *         description: 任务分配成功
   */
  bind('post', '/agents/:id/task', 'tasks.assign', value);

  // ---------------------------------------------------------------------------
  // 任务计划与运行历史
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

export function installGatewayRoutes(
  app: Express,
  manager: AgentManager,
  origin = webOrigin(),
  authenticated = false,
) {
  app.use(
    '/agents',
    ...(authenticated
      ? []
      : [
          createOriginGuard({
            origin,
            message: '仅允许配置的本机游戏页面管理 Agent。',
            vary: true,
            alwaysHeader: true,
            cacheControl: 'no-store',
            methods: 'GET, POST, PUT, DELETE, OPTIONS',
          }),
        ]),
    requireJsonBody,
    express.json({ limit: '32kb' }),
  );

  // Fixed resource paths must precede parameterized Agent paths. Keep the public URLs.
  installVoiceServiceRoutes(
    app,
    () => manager.voiceServices,
    (id) => manager.removeVoiceService(id),
  );

  installGatewayHttp(app, manager.gateway);

  app.use('/agents', (_req, res) => {
    res.status(404).json({ error: 'Agent 接口不存在，请确认前后端版本一致。' });
  });

  app.use(
    '/agents',
    errorHandler((error) => ({
      status:
        error instanceof SpeechError
          ? error.status
          : error.type === 'entity.too.large'
            ? 413
            : error instanceof SyntaxError
              ? 400
              : 500,
      body: {
        error:
          error instanceof SpeechError
            ? error.message
            : '无法处理请求，请检查输入或本机配置文件权限。',
      },
    })),
  );
}

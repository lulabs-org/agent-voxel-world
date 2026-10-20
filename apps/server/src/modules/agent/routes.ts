import type { Express } from 'express';
import type { AgentManager } from './manager';
import { asyncRoute as route } from '../../common/middleware/async-route';

/**
 * 安装 Agent 基础配置与生命周期控制相关 HTTP REST 路由
 */
export function installAgentRoutes(app: Express, manager: AgentManager) {
  // ---------------------------------------------------------------------------
  // Agent 基础与生命周期
  // ---------------------------------------------------------------------------

  /**
   * @openapi
   * /agents:
   *   get:
   *     security:
   *       - ManagementBearer: []
   *     summary: 获取所有 Agent 列表
   *     tags:
   *       - Agents
   *     responses:
   *       200:
   *         description: Agent 列表
   */
  app.get(
    '/agents',
    route((_req, res) => {
      res.json(manager.publicList());
    }),
  );

  /**
   * @openapi
   * /agents:
   *   post:
   *     security:
   *       - ManagementBearer: []
   *     summary: 创建 Agent（默认上线待命）
   *     description: 只保存角色配置并按 joinWorld 上线，不创建任务计划、执行记录或自动调用模型。任务请通过 Tasks 创建。
   *     tags:
   *       - Agents
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/AgentCreate'
   *     responses:
   *       201:
   *         description: 角色创建成功（上线待命或离线），无任务执行
   *       400:
   *         description: 参数无效或包含任务参数，请使用 Tasks
   */
  app.post(
    '/agents',
    route(async (req, res) => {
      const result = await manager.create(req.body);
      manager.events.publish('agents');
      res.status(201).json(result);
    }),
  );

  /**
   * @openapi
   * /agents/{id}:
   *   put:
   *     security:
   *       - ManagementBearer: []
   *     summary: 更新 Agent 角色配置
   *     description: 不创建或替换任务，不修改任务目标；startTask、taskTimeZone 或非空 goal 返回 400，请使用 Tasks。
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
   *             $ref: '#/components/schemas/AgentProfileUpdate'
   *     responses:
   *       200:
   *         description: 角色配置更新成功，已有任务进度保留
   *       400:
   *         description: 参数无效或包含任务参数，请使用 Tasks
   */
  app.put(
    '/agents/:id',
    route(async (req, res) => {
      const result = await manager.update(String(req.params.id), req.body);
      manager.events.publish('agents');
      res.json(result);
    }),
  );

  /**
   * @openapi
   * /agents/{id}:
   *   delete:
   *     security:
   *       - ManagementBearer: []
   *     summary: 停止并删除 Agent，保留任务计划、运行历史、世界建筑和共享服务
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
  app.delete(
    '/agents/:id',
    route(async (req, res) => {
      await manager.remove(String(req.params.id));
      manager.events.publish('agents');
      res.sendStatus(204);
    }),
  );

  /**
   * @openapi
   * /agents/{id}/join:
   *   post:
   *     security:
   *       - ManagementBearer: []
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
  app.post(
    '/agents/:id/join',
    route(async (req, res) => {
      const id = String(req.params.id);
      const result = manager.join(id);
      await manager.settled(id);
      res.json(result);
    }),
  );

  /**
   * @openapi
   * /agents/{id}/stop:
   *   post:
   *     security:
   *       - ManagementBearer: []
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
  app.post(
    '/agents/:id/stop',
    route(async (req, res) => {
      const id = String(req.params.id);
      const result = manager.stop(id);
      await manager.settled(id);
      res.json(result);
    }),
  );

  /**
   * @openapi
   * /agents/{id}/voice:
   *   post:
   *     security:
   *       - ManagementBearer: []
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
  app.post(
    '/agents/:id/voice',
    route(async (req, res) => {
      const result = await manager.setVoice(String(req.params.id), req.body);
      manager.events.publish('agents');
      res.json(result);
    }),
  );
}

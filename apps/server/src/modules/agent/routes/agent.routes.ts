import type { Express } from 'express';
import type { AgentManager } from '../manager';
import { asyncRoute as route } from '../../../common/middleware/async-route';
export function installAgentCrudRoutes(app: Express, manager: AgentManager) {
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
  app.get(
    '/agents',
    route((_req, res) => res.json(manager.list())),
  );

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
  app.post(
    '/agents',
    route((req, res) => res.status(201).json(manager.create(req.body))),
  );

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
  app.post(
    '/agents/:id/voice',
    route(async (req, res) =>
      res.json(await manager.setVoice(String(req.params.id), req.body)),
    ),
  );

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
  app.post(
    '/agents/:id/join',
    route((req, res) => res.json(manager.join(String(req.params.id)))),
  );

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
  app.post(
    '/agents/:id/resume',
    route((req, res) =>
      res.json(manager.resume(String(req.params.id), req.body)),
    ),
  );

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
  app.put(
    '/agents/:id',
    route(async (req, res) =>
      res.json(await manager.update(String(req.params.id), req.body)),
    ),
  );

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
  app.post(
    '/agents/:id/stop',
    route((req, res) => res.json(manager.stop(String(req.params.id)))),
  );
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
  app.delete(
    '/agents/:id',
    route(async (req, res) => {
      await manager.remove(String(req.params.id));
      res.sendStatus(204);
    }),
  );
}

import type { Express } from 'express';
import type { AgentManager } from '../manager';
import { asyncRoute as route } from '../../../common/middleware/async-route';
export function installAgentProviderRoutes(
  app: Express,
  manager: AgentManager,
) {
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
  app.get(
    '/agents/providers',
    route((_req, res) => res.json(manager.providers.list())),
  );

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
  app.post(
    '/agents/providers',
    route(async (req, res) =>
      res.status(201).json(await manager.providers.save(req.body)),
    ),
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
  app.put(
    '/agents/providers/:id',
    route(async (req, res) =>
      res.json(await manager.providers.save(req.body, String(req.params.id))),
    ),
  );

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
  app.delete(
    '/agents/providers/:id',
    route(async (req, res) => {
      await manager.removeProvider(String(req.params.id));
      res.sendStatus(204);
    }),
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
  app.get(
    '/agents/providers/:id/models',
    route(async (req, res) =>
      res.json({ models: await manager.models(String(req.params.id)) }),
    ),
  );
}

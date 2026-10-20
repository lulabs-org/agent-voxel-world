import type { Express } from 'express';
import type { ProviderPort } from './provider-port';
import { asyncRoute as route } from '../../common/middleware/async-route';

/**
 * 安装 Provider（模型提供商）相关 HTTP REST 路由
 */
export type ProviderRouteDependencies = {
  store: Pick<ProviderPort, 'list' | 'save'>;
  models: (id: string) => Promise<string[]>;
  remove: (id: string) => Promise<void>;
  changed: () => void;
};

export function installProviderRoutes(
  app: Express,
  providers: ProviderRouteDependencies,
) {
  /**
   * @openapi
   * /providers:
   *   get:
   *     security:
   *       - ManagementBearer: []
   *     summary: 获取 LLM 模型提供商配置列表
   *     tags:
   *       - Providers
   *     responses:
   *       200:
   *         description: 提供商配置列表
   */
  app.get(
    '/providers',
    route((_req, res) => {
      res.json(providers.store.list());
    }),
  );

  /**
   * @openapi
   * /providers:
   *   post:
   *     security:
   *       - ManagementBearer: []
   *     summary: 添加 LLM 模型提供商配置
   *     tags:
   *       - Providers
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
    '/providers',
    route(async (req, res) => {
      const result = await providers.store.save(req.body);
      providers.changed();
      res.status(201).json(result);
    }),
  );

  /**
   * @openapi
   * /providers/{id}:
   *   put:
   *     security:
   *       - ManagementBearer: []
   *     summary: 更新 LLM 模型提供商配置
   *     tags:
   *       - Providers
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
    '/providers/:id',
    route(async (req, res) => {
      const result = await providers.store.save(
        req.body,
        String(req.params.id),
      );
      providers.changed();
      res.json(result);
    }),
  );

  /**
   * @openapi
   * /providers/{id}:
   *   delete:
   *     security:
   *       - ManagementBearer: []
   *     summary: 删除 LLM 模型提供商配置
   *     tags:
   *       - Providers
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
    '/providers/:id',
    route(async (req, res) => {
      await providers.remove(String(req.params.id));
      providers.changed();
      res.sendStatus(204);
    }),
  );

  /**
   * @openapi
   * /providers/{id}/models:
   *   get:
   *     security:
   *       - ManagementBearer: []
   *     summary: 获取指定提供商下的可用模型列表
   *     tags:
   *       - Providers
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
    '/providers/:id/models',
    route(async (req, res) => {
      const models = await providers.models(String(req.params.id));
      res.json({ models });
    }),
  );
}

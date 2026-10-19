import type { Express } from 'express';
import type { AgentGateway } from '../../gateway/gateway';
import { createRpcBinder } from '../../gateway/bind';

/**
 * 安装 Provider（模型提供商）相关 HTTP REST 路由
 */
export function installProviderRoutes(app: Express, g: AgentGateway) {
  const bind = createRpcBinder(app, g);

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
}

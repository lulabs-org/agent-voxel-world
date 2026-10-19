import type { Express, Request } from 'express';
import type { AgentGateway } from '../../gateway/gateway';
import { createRpcBinder } from '../../gateway/bind';

const agent = (r: Request) => ({ agentId: String(r.params.id) });
const value = (r: Request) => ({ ...agent(r), value: r.body ?? {} });

/**
 * 安装 Agent 基础配置与生命周期控制相关 HTTP REST 路由
 */
export function installAgentRoutes(app: Express, g: AgentGateway) {
  const bind = createRpcBinder(app, g);

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
}

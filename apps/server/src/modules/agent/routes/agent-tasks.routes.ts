import type { Express } from 'express';
import type { AgentManager } from '../manager';
import { asyncRoute as route } from '../../../common/middleware/async-route';
export function installAgentTaskRoutes(app: Express, manager: AgentManager) {
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
  app.get(
    '/agents/:id/tasks',
    route((req, res) => res.json(manager.taskPlans(String(req.params.id)))),
  );

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
  app.post(
    '/agents/:id/tasks',
    route(async (req, res) =>
      res
        .status(201)
        .json(await manager.createTaskPlan(String(req.params.id), req.body)),
    ),
  );

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
  app.put(
    '/agents/:id/tasks/:planId',
    route(async (req, res) =>
      res.json(
        await manager.updateTaskPlan(
          String(req.params.id),
          String(req.params.planId),
          req.body,
        ),
      ),
    ),
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
  app.get(
    '/agents/:id/tasks/:planId/runs',
    route((req, res) =>
      res.json(
        manager.taskRuns(
          String(req.params.id),
          String(req.params.planId),
          Number(req.query.offset ?? 0),
        ),
      ),
    ),
  );

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
  app.post(
    '/agents/:id/tasks/:planId/:operation',
    route(async (req, res) =>
      res.json(
        await manager.controlTaskPlan(
          String(req.params.id),
          String(req.params.planId),
          String(req.params.operation),
          req.body,
        ),
      ),
    ),
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
  app.post(
    '/agents/:id/task-runs/:runId/:operation',
    route(async (req, res) =>
      res.json(
        await manager.controlTaskRun(
          String(req.params.id),
          String(req.params.runId),
          String(req.params.operation),
          req.body,
        ),
      ),
    ),
  );

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
  app.post(
    '/agents/:id/pause',
    route(async (req, res) =>
      res.json(await manager.controlTask(String(req.params.id), 'pause')),
    ),
  );

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
  app.post(
    '/agents/:id/cancel',
    route(async (req, res) =>
      res.json(await manager.controlTask(String(req.params.id), 'cancel')),
    ),
  );

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
  app.post(
    '/agents/:id/task',
    route(async (req, res) =>
      res.json(await manager.assignTask(String(req.params.id), req.body)),
    ),
  );
}

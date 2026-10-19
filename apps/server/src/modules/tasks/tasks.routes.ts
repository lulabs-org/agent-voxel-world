import type { Express } from 'express';
import { asyncRoute as route } from '../../common/middleware/async-route';
import type { RpcParams } from '@voxel/gateway-protocol';
import { TasksService, type TasksManagerPort, type TaskPort } from './task-port';

/**
 * 安装 Task / Plan（任务计划与运行历史）相关 HTTP REST 路由
 */
export function installTaskRoutes(
  app: Express,
  managerOrService: TasksManagerPort | TasksService,
) {
  const service =
    managerOrService instanceof TasksService
      ? managerOrService
      : new TasksService(managerOrService);

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
  app.get(
    '/agents/tasks',
    route((req, res) => {
      const page = service.listGlobalPlans({
        state: (req.query.state
          ? String(req.query.state)
          : undefined) as RpcParams['state'],
        offset:
          req.query.offset !== undefined ? Number(req.query.offset) : undefined,
        search: req.query.search ? String(req.query.search) : undefined,
        agentId: req.query.agentId ? String(req.query.agentId) : undefined,
      });
      res.json(page);
    }),
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
  app.post(
    '/agents/tasks',
    route(async (req, res) => {
      const agentId = String(req.body?.agentId ?? '');
      const result = await service.createPlan(agentId, req.body ?? {});
      res.status(201).json(result);
    }),
  );

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
  app.get(
    '/agents/tasks/:planId',
    route((req, res) => {
      res.json(service.getPlan(String(req.params.planId)));
    }),
  );

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
  app.put(
    '/agents/tasks/:planId',
    route(async (req, res) => {
      const planId = String(req.params.planId);
      const agentId = req.body?.agentId ? String(req.body.agentId) : undefined;
      const result = await service.updatePlan(
        agentId,
        planId,
        req.body ?? {},
      );
      res.json(result);
    }),
  );

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
  app.delete(
    '/agents/tasks/:planId',
    route(async (req, res) => {
      await service.deletePlan(undefined, String(req.params.planId));
      res.sendStatus(204);
    }),
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
  app.post(
    '/agents/tasks/:planId/reassign',
    route(async (req, res) => {
      const result = await service.reassignPlan(
        String(req.params.planId),
        String(req.body?.targetAgentId ?? ''),
      );
      res.json(result);
    }),
  );

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
   *     responses:
   *       200:
   *         description: 任务运行历史记录
   */
  app.get(
    '/agents/tasks/:planId/runs',
    route((req, res) => {
      const result = service.listRuns(
        undefined,
        String(req.params.planId),
        Number(req.query.offset ?? 0),
        true,
      );
      res.json(result);
    }),
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
  app.post(
    '/agents/tasks/:planId/:operation',
    route(async (req, res) => {
      const result = await service.controlPlan(
        undefined,
        String(req.params.planId),
        String(req.params.operation),
        req.body ?? {},
      );
      res.json(result);
    }),
  );

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
  app.post(
    '/agents/task-runs/:runId/:operation',
    route(async (req, res) => {
      const agentId = req.body?.agentId ? String(req.body.agentId) : '';
      const result = await service.controlRun(
        agentId,
        String(req.params.runId),
        String(req.params.operation),
        req.body ?? {},
      );
      res.json(result);
    }),
  );

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
  app.get(
    '/agents/:id/tasks',
    route((req, res) => {
      res.json(service.listAgentPlans(String(req.params.id)));
    }),
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
    route(async (req, res) => {
      const result = await service.createPlan(
        String(req.params.id),
        req.body ?? {},
      );
      res.status(201).json(result);
    }),
  );

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
  app.get(
    '/agents/:id/tasks/:planId',
    route((req, res) => {
      res.json(service.getPlan(String(req.params.planId)));
    }),
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
    route(async (req, res) => {
      const result = await service.updatePlan(
        String(req.params.id),
        String(req.params.planId),
        req.body ?? {},
      );
      res.json(result);
    }),
  );

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
   *     responses:
   *       204:
   *         description: 删除成功
   */
  app.delete(
    '/agents/:id/tasks/:planId',
    route(async (req, res) => {
      await service.deletePlan(
        String(req.params.id),
        String(req.params.planId),
      );
      res.sendStatus(204);
    }),
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
   *     responses:
   *       200:
   *         description: 任务运行历史记录
   */
  app.get(
    '/agents/:id/tasks/:planId/runs',
    route((req, res) => {
      res.json(
        service.listRuns(
          String(req.params.id),
          String(req.params.planId),
          Number(req.query.offset ?? 0),
          false,
        ),
      );
    }),
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
    route(async (req, res) => {
      const result = await service.controlPlan(
        String(req.params.id),
        String(req.params.planId),
        String(req.params.operation),
        req.body ?? {},
      );
      res.json(result);
    }),
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
   *     responses:
   *       200:
   *         description: 操作成功
   */
  app.post(
    '/agents/:id/task-runs/:runId/:operation',
    route(async (req, res) => {
      const result = await service.controlRun(
        String(req.params.id),
        String(req.params.runId),
        String(req.params.operation),
        req.body ?? {},
      );
      res.json(result);
    }),
  );
}

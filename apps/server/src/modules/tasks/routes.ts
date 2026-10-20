import type { Express, Request, Response } from 'express';
import { asyncRoute as route } from '../../common/middleware/async-route';
import type { RpcParams } from '@voxel/gateway-protocol';
import { TasksService, type TaskPort } from './port';

/**
 * 安装 Task / Plan（任务计划与运行历史）相关 HTTP REST 路由
 */
export function installTaskRoutes(
  app: Express,
  tasksOrService: TaskPort | TasksService,
) {
  const service =
    tasksOrService instanceof TasksService
      ? tasksOrService
      : new TasksService(tasksOrService);

  // ---------------------------------------------------------------------------
  // 任务计划与执行运行的 HTTP 适配
  // ---------------------------------------------------------------------------

  const resolveAgentId = (req: Request): string | undefined =>
    req.body?.agentId ? String(req.body.agentId) : undefined;

  const handleGetPlan = (req: Request, res: Response) => {
    res.json(service.getPlan(String(req.params.planId)));
  };

  const handleCreatePlan = async (req: Request, res: Response) => {
    const agentId = resolveAgentId(req) ?? '';
    const result = await service.createPlan(agentId, req.body ?? {});
    res.status(201).json(result);
  };

  const handleUpdatePlan = async (req: Request, res: Response) => {
    const result = await service.updatePlan(
      resolveAgentId(req),
      String(req.params.planId),
      req.body ?? {},
    );
    res.json(result);
  };

  const handleDeletePlan = async (req: Request, res: Response) => {
    await service.deletePlan(resolveAgentId(req), String(req.params.planId));
    res.sendStatus(204);
  };

  const handleControlPlan = async (req: Request, res: Response) => {
    const result = await service.controlPlan(
      resolveAgentId(req),
      String(req.params.planId),
      String(req.params.operation),
      req.body ?? {},
    );
    res.json(result);
  };

  const handleControlRun = async (req: Request, res: Response) => {
    const agentId = resolveAgentId(req);
    const result = await service.controlRun(
      agentId,
      String(req.params.runId),
      String(req.params.operation),
      req.body ?? {},
    );
    res.json(result);
  };

  // ---------------------------------------------------------------------------
  // 1. 任务计划列表与详情
  // ---------------------------------------------------------------------------

  /**
   * @openapi
   * /tasks:
   *   get:
   *     summary: 获取全局任务计划列表
   *     tags:
   *     - Tasks
   *     security:
   *     - ManagementBearer: []
   *     parameters:
   *     - in: query
   *       name: state
   *       schema:
   *         type: string
   *         enum:
   *         - unassigned
   *         - enabled
   *         - paused
   *         - completed
   *         - archived
   *     - in: query
   *       name: agentId
   *       schema:
   *         type: string
   *     - in: query
   *       name: search
   *       schema:
   *         type: string
   *     - in: query
   *       name: offset
   *       schema:
   *         type: integer
   *         minimum: 0
   *     responses:
   *       '200':
   *         description: 操作成功
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TaskPlanPage'
   *       '400':
   *         $ref: '#/components/responses/Management400'
   *       '401':
   *         $ref: '#/components/responses/Management401'
   *       '403':
   *         $ref: '#/components/responses/Management403'
   *       '404':
   *         $ref: '#/components/responses/Management404'
   *       '409':
   *         $ref: '#/components/responses/Management409'
   *       '413':
   *         $ref: '#/components/responses/Management413'
   *       '415':
   *         $ref: '#/components/responses/Management415'
   */
  app.get(
    '/tasks',
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
   * /tasks/{planId}:
   *   get:
   *     summary: 获取指定任务计划详情
   *     tags:
   *     - Tasks
   *     security:
   *     - ManagementBearer: []
   *     parameters:
   *     - in: path
   *       name: planId
   *       required: true
   *       schema:
   *         type: string
   *     responses:
   *       '200':
   *         description: 操作成功
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TaskPlan'
   *       '400':
   *         $ref: '#/components/responses/Management400'
   *       '401':
   *         $ref: '#/components/responses/Management401'
   *       '403':
   *         $ref: '#/components/responses/Management403'
   *       '404':
   *         $ref: '#/components/responses/Management404'
   *       '409':
   *         $ref: '#/components/responses/Management409'
   *       '413':
   *         $ref: '#/components/responses/Management413'
   *       '415':
   *         $ref: '#/components/responses/Management415'
   */
  app.get('/tasks/:planId', route(handleGetPlan));

  // ---------------------------------------------------------------------------
  // 2. 创建与更新任务计划
  // ---------------------------------------------------------------------------

  /**
   * @openapi
   * /tasks:
   *   post:
   *     summary: 创建任务计划（即时任务创建后立即执行）
   *     description: timing.kind 为 immediate 时创建计划及首次执行，角色须已上线且无正在运行的任务，无需再次调用 run。
   *     tags:
   *     - Tasks
   *     security:
   *     - ManagementBearer: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/TaskPlanCreate'
   *     responses:
   *       '201':
   *         description: 操作成功
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TaskPlan'
   *       '400':
   *         $ref: '#/components/responses/Management400'
   *       '401':
   *         $ref: '#/components/responses/Management401'
   *       '403':
   *         $ref: '#/components/responses/Management403'
   *       '404':
   *         $ref: '#/components/responses/Management404'
   *       '409':
   *         $ref: '#/components/responses/Management409'
   *       '413':
   *         $ref: '#/components/responses/Management413'
   *       '415':
   *         $ref: '#/components/responses/Management415'
   */
  app.post('/tasks', route(handleCreatePlan));

  /**
   * @openapi
   * /tasks/{planId}:
   *   put:
   *     summary: 更新指定任务计划
   *     tags:
   *     - Tasks
   *     security:
   *     - ManagementBearer: []
   *     parameters:
   *     - in: path
   *       name: planId
   *       required: true
   *       schema:
   *         type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/TaskPlanUpdate'
   *     responses:
   *       '200':
   *         description: 操作成功
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TaskPlan'
   *       '400':
   *         $ref: '#/components/responses/Management400'
   *       '401':
   *         $ref: '#/components/responses/Management401'
   *       '403':
   *         $ref: '#/components/responses/Management403'
   *       '404':
   *         $ref: '#/components/responses/Management404'
   *       '409':
   *         $ref: '#/components/responses/Management409'
   *       '413':
   *         $ref: '#/components/responses/Management413'
   *       '415':
   *         $ref: '#/components/responses/Management415'
   */
  app.put('/tasks/:planId', route(handleUpdatePlan));

  // ---------------------------------------------------------------------------
  // 3. 删除与重新指派
  // ---------------------------------------------------------------------------

  /**
   * @openapi
   * /tasks/{planId}:
   *   delete:
   *     summary: 删除指定任务计划
   *     tags:
   *     - Tasks
   *     security:
   *     - ManagementBearer: []
   *     parameters:
   *     - in: path
   *       name: planId
   *       required: true
   *       schema:
   *         type: string
   *     responses:
   *       '204':
   *         description: 操作成功
   *       '400':
   *         $ref: '#/components/responses/Management400'
   *       '401':
   *         $ref: '#/components/responses/Management401'
   *       '403':
   *         $ref: '#/components/responses/Management403'
   *       '404':
   *         $ref: '#/components/responses/Management404'
   *       '409':
   *         $ref: '#/components/responses/Management409'
   *       '413':
   *         $ref: '#/components/responses/Management413'
   *       '415':
   *         $ref: '#/components/responses/Management415'
   */
  app.delete('/tasks/:planId', route(handleDeletePlan));

  /**
   * @openapi
   * /tasks/{planId}/reassign:
   *   post:
   *     summary: 重新指派任务计划所属 Agent
   *     tags:
   *     - Tasks
   *     security:
   *     - ManagementBearer: []
   *     parameters:
   *     - in: path
   *       name: planId
   *       required: true
   *       schema:
   *         type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *             - targetAgentId
   *             properties:
   *               targetAgentId:
   *                 type: string
   *     responses:
   *       '200':
   *         description: 操作成功
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TaskPlan'
   *       '400':
   *         $ref: '#/components/responses/Management400'
   *       '401':
   *         $ref: '#/components/responses/Management401'
   *       '403':
   *         $ref: '#/components/responses/Management403'
   *       '404':
   *         $ref: '#/components/responses/Management404'
   *       '409':
   *         $ref: '#/components/responses/Management409'
   *       '413':
   *         $ref: '#/components/responses/Management413'
   *       '415':
   *         $ref: '#/components/responses/Management415'
   */
  app.post(
    '/tasks/:planId/reassign',
    route(async (req, res) => {
      const result = await service.reassignPlan(
        String(req.params.planId),
        String(req.body?.targetAgentId ?? ''),
      );
      res.json(result);
    }),
  );

  // ---------------------------------------------------------------------------
  // 4. 运行历史
  // ---------------------------------------------------------------------------

  /**
   * @openapi
   * /tasks/{planId}/runs:
   *   get:
   *     summary: 获取任务计划的执行运行历史（含元数据）
   *     tags:
   *     - Tasks
   *     security:
   *     - ManagementBearer: []
   *     parameters:
   *     - in: path
   *       name: planId
   *       required: true
   *       schema:
   *         type: string
   *     - in: query
   *       name: offset
   *       schema:
   *         type: integer
   *         minimum: 0
   *     responses:
   *       '200':
   *         description: 操作成功
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TaskRunPage'
   *       '400':
   *         $ref: '#/components/responses/Management400'
   *       '401':
   *         $ref: '#/components/responses/Management401'
   *       '403':
   *         $ref: '#/components/responses/Management403'
   *       '404':
   *         $ref: '#/components/responses/Management404'
   *       '409':
   *         $ref: '#/components/responses/Management409'
   *       '413':
   *         $ref: '#/components/responses/Management413'
   *       '415':
   *         $ref: '#/components/responses/Management415'
   */
  app.get(
    '/tasks/:planId/runs',
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

  // ---------------------------------------------------------------------------
  // 5. 控制状态操作（Plan / Run）
  // ---------------------------------------------------------------------------

  /**
   * @openapi
   * /tasks/{planId}/{operation}:
   *   post:
   *     summary: 控制任务计划调度或发起新执行
   *     description: pause 停止后续调度，不影响当前执行；resume 恢复定时调度；run 创建新的执行。暂停或继续已有执行请使用 task-runs。
   *     tags:
   *     - Tasks
   *     security:
   *     - ManagementBearer: []
   *     parameters:
   *     - in: path
   *       name: planId
   *       required: true
   *       schema:
   *         type: string
   *     - in: path
   *       name: operation
   *       required: true
   *       schema:
   *         type: string
   *         enum:
   *         - run
   *         - pause
   *         - resume
   *         - archive
   *         - extend
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/TaskControl'
   *     responses:
   *       '200':
   *         description: 操作成功
   *         content:
   *           application/json:
   *             schema:
   *               oneOf:
   *               - $ref: '#/components/schemas/TaskPlan'
   *               - $ref: '#/components/schemas/TaskRun'
   *       '400':
   *         $ref: '#/components/responses/Management400'
   *       '401':
   *         $ref: '#/components/responses/Management401'
   *       '403':
   *         $ref: '#/components/responses/Management403'
   *       '404':
   *         $ref: '#/components/responses/Management404'
   *       '409':
   *         $ref: '#/components/responses/Management409'
   *       '413':
   *         $ref: '#/components/responses/Management413'
   *       '415':
   *         $ref: '#/components/responses/Management415'
   */
  app.post('/tasks/:planId/:operation', route(handleControlPlan));

  /**
   * @openapi
   * /task-runs/{runId}/{operation}:
   *   post:
   *     summary: 暂停、继续或取消指定任务执行
   *     description: 按 runId 操作已有执行；resume 不新建任务也不自动上线角色，角色须先通过 join 上线。
   *     tags:
   *     - Tasks
   *     security:
   *     - ManagementBearer: []
   *     parameters:
   *     - in: path
   *       name: runId
   *       required: true
   *       schema:
   *         type: string
   *     - in: path
   *       name: operation
   *       required: true
   *       schema:
   *         type: string
   *         enum:
   *         - pause
   *         - resume
   *         - cancel
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/TaskControl'
   *     responses:
   *       '200':
   *         description: 操作成功
   *         content:
   *           application/json:
   *             schema:
   *               oneOf:
   *               - $ref: '#/components/schemas/TaskRun'
   *               - $ref: '#/components/schemas/AgentView'
   *       '400':
   *         $ref: '#/components/responses/Management400'
   *       '401':
   *         $ref: '#/components/responses/Management401'
   *       '403':
   *         $ref: '#/components/responses/Management403'
   *       '404':
   *         $ref: '#/components/responses/Management404'
   *       '409':
   *         $ref: '#/components/responses/Management409'
   *       '413':
   *         $ref: '#/components/responses/Management413'
   *       '415':
   *         $ref: '#/components/responses/Management415'
   */
  app.post('/task-runs/:runId/:operation', route(handleControlRun));
}

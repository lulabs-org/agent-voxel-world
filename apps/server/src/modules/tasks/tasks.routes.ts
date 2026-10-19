import type { Express, Request, Response } from 'express';
import { asyncRoute as route } from '../../common/middleware/async-route';
import type { RpcParams } from '@voxel/gateway-protocol';
import { TasksService, type TaskPort } from './task-port';

/**
 * 安装 Task / Plan（任务计划与运行历史）相关 HTTP REST 路由
 */
export function installTaskRoutes(
  app: Express,
  managerOrService: TaskPort | TasksService,
) {
  const service =
    managerOrService instanceof TasksService
      ? managerOrService
      : new TasksService(managerOrService);

  // ---------------------------------------------------------------------------
  // 辅助处理函数（消除全局路由与 Agent 作用域路由的重复实现）
  // ---------------------------------------------------------------------------

  const resolveAgentId = (req: Request): string | undefined =>
    req.params.id
      ? String(req.params.id)
      : req.body?.agentId
        ? String(req.body.agentId)
        : undefined;

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
    const agentId = resolveAgentId(req) ?? '';
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
   * /agents/tasks:
   *   get:
   *     summary: 获取全局任务计划列表
   *     tags:
   *       - Agents Task
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
   * /agents/tasks/{planId}:
   *   get:
   *     summary: 获取指定任务计划详情
   *     tags:
   *       - Agents Task
   */
  app.get('/agents/tasks/:planId', route(handleGetPlan));

  // ---------------------------------------------------------------------------
  // 2. 创建与更新任务计划
  // ---------------------------------------------------------------------------

  /**
   * @openapi
   * /agents/tasks:
   *   post:
   *     summary: 创建任务计划
   *     tags:
   *       - Agents Task
   */
  app.post('/agents/tasks', route(handleCreatePlan));

  /**
   * @openapi
   * /agents/tasks/{planId}:
   *   put:
   *     summary: 更新指定任务计划
   *     tags:
   *       - Agents Task
   */
  app.put('/agents/tasks/:planId', route(handleUpdatePlan));

  // ---------------------------------------------------------------------------
  // 3. 删除与重新指派
  // ---------------------------------------------------------------------------

  /**
   * @openapi
   * /agents/tasks/{planId}:
   *   delete:
   *     summary: 删除指定任务计划
   *     tags:
   *       - Agents Task
   */
  app.delete('/agents/tasks/:planId', route(handleDeletePlan));

  /**
   * @openapi
   * /agents/tasks/{planId}/reassign:
   *   post:
   *     summary: 重新指派任务计划所属 Agent
   *     tags:
   *       - Agents Task
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

  // ---------------------------------------------------------------------------
  // 4. 运行历史
  // ---------------------------------------------------------------------------

  /**
   * @openapi
   * /agents/tasks/{planId}/runs:
   *   get:
   *     summary: 获取任务计划的执行运行历史（含元数据）
   *     tags:
   *       - Agents Task
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

  // ---------------------------------------------------------------------------
  // 5. 控制状态操作（Plan / Run）
  // ---------------------------------------------------------------------------

  /**
   * @openapi
   * /agents/tasks/{planId}/{operation}:
   *   post:
   *     summary: 控制任务计划状态
   *     tags:
   *       - Agents Task
   */
  app.post('/agents/tasks/:planId/:operation', route(handleControlPlan));

  /**
   * @openapi
   * /agents/task-runs/{runId}/{operation}:
   *   post:
   *     summary: 控制特定任务运行状态
   *     tags:
   *       - Agents Task
   */
  app.post('/agents/task-runs/:runId/:operation', route(handleControlRun));
}

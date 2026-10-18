import { TaskPlanError } from '../agent/task-scheduler';
import express, {
  type Express,
  type ErrorRequestHandler,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { AgentManager, ManagementError } from '../agent/manager';
import { SpeechError } from '../audio/local-speech';
export function installAgentRoutes(app: Express, manager: AgentManager) {
  const origin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
  app.use(
    '/agents',
    (req, res, next) => {
      // These local controls can spend API credit. Require the configured page origin.
      if (origin !== '*' && req.headers.origin !== origin) {
        res.status(403).json({ error: '仅允许配置的本机游戏页面管理 Agent。' });
        return;
      }
      res.header(
        'Access-Control-Allow-Origin',
        origin === '*' ? (req.headers.origin ?? '*') : origin,
      );
      res.header('Vary', 'Origin');
      res.header('Cache-Control', 'no-store');
      if (req.method === 'OPTIONS') {
        res.header(
          'Access-Control-Allow-Methods',
          'GET, POST, PUT, DELETE, OPTIONS',
        );
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        res.sendStatus(204);
        return;
      }
      if (['POST', 'PUT'].includes(req.method) && !req.is('application/json')) {
        res.status(415).json({ error: '请使用 JSON 请求。' });
        return;
      }
      next();
    },
    express.json({ limit: '32kb' }),
  );
  const route =
    (fn: (req: Request, res: Response) => unknown) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve()
        .then(() => fn(req, res))
        .catch(next);
    };
  const voices = () => {
    if (!manager.voiceServices)
      throw new ManagementError('语音服务未就绪。', 503);
    return manager.voiceServices;
  };
  /**
   * @openapi
   * /agents/voice-services:
   *   get:
   *     summary: 获取 Agent 语音合成服务配置列表
   *     tags:
   *       - Agents Voice
   *     responses:
   *       200:
   *         description: 语音服务配置列表
   */
  app.get(
    '/agents/voice-services',
    route((_req, res) => res.json(voices().list())),
  );

  /**
   * @openapi
   * /agents/voice-services:
   *   post:
   *     summary: 添加新的 Agent 语音合成服务配置
   *     tags:
   *       - Agents Voice
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
    '/agents/voice-services',
    route(async (req, res) =>
      res.status(201).json(await voices().save(req.body)),
    ),
  );

  /**
   * @openapi
   * /agents/voice-services/{id}:
   *   put:
   *     summary: 更新 Agent 语音合成服务配置
   *     tags:
   *       - Agents Voice
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
    '/agents/voice-services/:id',
    route(async (req, res) =>
      res.json(await voices().save(req.body, String(req.params.id))),
    ),
  );

  /**
   * @openapi
   * /agents/voice-services/{id}:
   *   delete:
   *     summary: 删除 Agent 语音合成服务配置
   *     tags:
   *       - Agents Voice
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
    '/agents/voice-services/:id',
    route(async (req, res) => {
      await manager.removeVoiceService(String(req.params.id));
      res.sendStatus(204);
    }),
  );

  /**
   * @openapi
   * /agents/voice-services/{id}/preview:
   *   post:
   *     summary: 试听 Agent 语音合成效果
   *     tags:
   *       - Agents Voice
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
   *             properties:
   *               text:
   *                 type: string
   *                 example: "你好，我是智能体。"
   *     responses:
   *       200:
   *         description: 合成的 WAV 音频
   *         content:
   *           audio/wav:
   *             schema:
   *               type: string
   *               format: binary
   */
  app.post(
    '/agents/voice-services/:id/preview',
    route(async (req, res) => {
      const abort = new AbortController();
      const cancel = () => {
        if (!res.writableEnded) abort.abort();
      };
      res.on('close', cancel);
      try {
        const audio = await voices().synthesize(
          String(req.params.id),
          req.body?.text,
          abort.signal,
        );
        if (!abort.signal.aborted) res.type('audio/wav').send(audio.bytes);
      } catch (error) {
        if (!abort.signal.aborted) throw error;
      } finally {
        res.off('close', cancel);
      }
    }),
  );

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
  app.use('/agents', (_req, res) => {
    res.status(404).json({ error: 'Agent 接口不存在，请确认前后端版本一致。' });
  });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (
      error instanceof ManagementError ||
      error instanceof SpeechError ||
      error instanceof TaskPlanError
    )
      res.status(error.status).json({ error: error.message });
    else
      res
        .status(
          error.type === 'entity.too.large'
            ? 413
            : error instanceof SyntaxError
              ? 400
              : 500,
        )
        .json({ error: '无法处理请求，请检查输入或本机配置文件权限。' });
  };
  app.use('/agents', errors);
}

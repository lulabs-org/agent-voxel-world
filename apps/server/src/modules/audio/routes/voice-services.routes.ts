import type { Express } from 'express';
import type { VoiceServiceStore } from '../tts/voice-services';
import { AppError } from '../../../common/errors';
import { asyncRoute as route } from '../../../common/middleware/async-route';
export function installVoiceServiceRoutes(
  app: Express,
  getVoices: () => VoiceServiceStore | undefined,
  removeVoice: (id: string) => Promise<unknown>,
) {
  const voices = () => {
    const value = getVoices();
    if (!value) throw new AppError('语音服务未就绪。', 503);
    return value;
  };
  /**
   * @openapi
   * /agents/voice-services/piper/models:
   *   get:
   *     summary: 查询 Piper 模型目录与安装状态
   *     tags: [Agents]
   *     responses:
   *       200:
   *         description: 固定中英文模型目录，状态为 missing、installing、installed 或 failed
   *       503:
   *         description: 无法连接共享语音服务
   * /agents/voice-services/piper/install:
   *   post:
   *     summary: 后台安装 Piper 模型
   *     tags: [Agents]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [model]
   *             properties:
   *               model:
   *                 type: string
   *     responses:
   *       202:
   *         description: 安装已开始或复用已有任务，通过模型目录查询结果
   *       400:
   *         description: 不支持的模型
   *       409:
   *         description: 另一个模型正在安装
   */
  // Fixed catalog and server-owned downloads; never accept an upstream URL.
  app.get(
    '/agents/voice-services/piper/models',
    route(async (_req, res) => {
      res.json(await voices().piperModels.list());
    }),
  );
  app.post(
    '/agents/voice-services/piper/install',
    route(async (req, res) => {
      res.status(202).json(voices().piperModels.start(req.body?.model));
    }),
  );

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
      await removeVoice(String(req.params.id));
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
}

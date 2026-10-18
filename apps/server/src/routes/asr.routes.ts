import express, {
  type Express,
  type ErrorRequestHandler,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import type { Server } from 'node:http';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { AsrSettingsStore } from '../audio/asr-settings';
import { SpeechError } from '../audio/local-speech';
import { bridgeBailianAsr } from '../audio/bailian-asr';

export function installAsrRoutes(app: Express, store: AsrSettingsStore) {
  app.use('/voice/asr', (req, res, next) => {
    if (
      req.headers.origin !== (process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173')
    ) {
      res.status(403).json({ error: '仅允许配置的游戏页面管理语音识别。' });
      return;
    }
    res.header('Cache-Control', 'no-store');
    next();
  });
  app.use('/voice/asr', express.json({ limit: '8kb' }));
  const route =
    (fn: (req: Request, res: Response) => unknown) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve()
        .then(() => {
          if (
            ['POST', 'PUT'].includes(req.method) &&
            !req.is('application/json')
          )
            throw new SpeechError('请使用 JSON 请求。', 415);
          return fn(req, res);
        })
        .catch(next);
    };
  /**
   * @openapi
   * /voice/asr/services:
   *   get:
   *     summary: 获取 ASR 语音识别服务配置列表
   *     tags:
   *       - ASR
   *     responses:
   *       200:
   *         description: ASR 服务配置列表
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   */
  app.get('/voice/asr/services', (_req, res) => res.json(store.list()));

  /**
   * @openapi
   * /voice/asr/services:
   *   post:
   *     summary: 添加新的 ASR 语音识别服务配置
   *     tags:
   *       - ASR
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       201:
   *         description: 创建成功
   *       400:
   *         description: 配置参数错误
   *       415:
   *         description: 请求非 JSON 格式
   */
  app.post(
    '/voice/asr/services',
    route(async (req, res) => res.status(201).json(await store.save(req.body))),
  );

  /**
   * @openapi
   * /voice/asr/services/{id}:
   *   put:
   *     summary: 更新 ASR 语音识别服务配置
   *     tags:
   *       - ASR
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: ASR 服务 ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: 更新成功
   *       400:
   *         description: 配置格式错误
   */
  app.put(
    '/voice/asr/services/:id',
    route(async (req, res) =>
      res.json(await store.save(req.body, String(req.params.id))),
    ),
  );

  /**
   * @openapi
   * /voice/asr/services/{id}:
   *   delete:
   *     summary: 删除 ASR 语音识别服务配置
   *     tags:
   *       - ASR
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: ASR 服务 ID
   *     responses:
   *       204:
   *         description: 删除成功
   */
  app.delete(
    '/voice/asr/services/:id',
    route(async (req, res) => {
      await store.remove(String(req.params.id));
      res.sendStatus(204);
    }),
  );
  const invalidBody: ErrorRequestHandler = (error, _req, res, _next) => {
    res
      .status(
        error instanceof SpeechError
          ? error.status
          : error.type === 'entity.too.large'
            ? 413
            : error.type === 'entity.parse.failed'
              ? 400
              : 500,
      )
      .json({
        error:
          error instanceof SpeechError
            ? error.message
            : error.type
              ? '识别配置须为有效 JSON，且不超过 8 KiB。'
              : '识别服务操作失败，请重试。',
      });
  };
  app.use('/voice/asr', invalidBody);
}

/** Shares Colyseus' socket server and heartbeat, dispatching only the explicit ASR path. */
export class AsrWebSocketTransport extends WebSocketTransport {
  constructor(
    server: Server,
    store: AsrSettingsStore,
    bridge = bridgeBailianAsr,
  ) {
    super({ server, maxPayload: 16384 });
    let running = 0;
    this.wss.off('connection', this.onConnection);
    this.wss.on('connection', (socket, req) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const client = Object.assign(socket, { pingCount: 0 });
      if (url.pathname !== '/voice/asr/realtime') {
        void this.onConnection(client, req);
        return;
      }
      client.on('pong', () => {
        client.pingCount = 0;
      });
      client.on('error', () => {});
      const reject = (message: string) => {
        client.send(JSON.stringify({ type: 'error', message }));
        client.close();
      };
      if (
        req.headers.origin !==
        (process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173')
      ) {
        reject('不允许此页面访问实时识别。');
        return;
      }
      if (running >= 2) {
        reject('实时识别服务繁忙，请稍后重试。');
        return;
      }
      const language = url.searchParams.get('language');
      if (language !== 'zh' && language !== 'en') {
        reject('不支持的识别语言。');
        return;
      }
      try {
        const serviceId = url.searchParams.get('serviceId');
        if (!serviceId) throw new SpeechError('请先选择已保存的识别服务。');
        if (store.get(serviceId).provider === 'whisper')
          throw new SpeechError('Whisper 服务请使用服务器音频识别接口。');
        const { settings, release } = store.acquire(serviceId);
        if (settings.provider === 'whisper') {
          release();
          return;
        }
        running++;
        client.once('close', () => {
          running--;
          release();
        });
        bridge(client, settings, language);
      } catch (error) {
        reject(
          error instanceof SpeechError
            ? error.message
            : '无法启动识别，请检查服务配置。',
        );
      }
    });
  }
}

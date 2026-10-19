import { env } from '../../config/env';
import { createOriginGuard } from '../../common/middleware/cors';
import { errorHandler } from '../../common/middleware/error-handler';
import express, { type Express } from 'express';
import { type WorldChat } from './chat';
import { ChatError } from './errors';
import { LocalSpeech } from '../audio/asr/local-speech';
import { SpeechError } from '../audio/errors';
import type { AgentSpeech } from '../agent/speech';
import { scheduleSpeech } from '../audio/tts/speech-scheduler';
export function installChatRoutes(
  app: Express,
  getChat: () => WorldChat | undefined,
  speech = new LocalSpeech(),
  getAgentSpeech: () => AgentSpeech | undefined = () => undefined,
  origin = env.webOrigin(),
) {
  app.use(
    '/chat',
    createOriginGuard({
      origin,
      message: '不允许此页面访问聊天音频。',
      vary: true,
      alwaysHeader: true,
      cacheControl: 'no-store',
      methods: 'GET, POST, DELETE, OPTIONS',
      headers: 'Content-Type, Authorization',
    }),
    (req, res, next) => {
      try {
        const chat = getChat();
        if (!chat) throw new ChatError('世界服务尚未就绪。', 503);
        res.locals.chat = chat;
        res.locals.actor = chat.authenticate(
          (req.headers.authorization ?? '').replace(/^Bearer /, ''),
        );
        next();
      } catch (e) {
        next(e);
      }
    },
  );
  /**
   * @openapi
   * /chat/audio:
   *   post:
   *     summary: 上传并发布语音聊天消息
   *     tags:
   *       - Chat
   *     parameters:
   *       - in: query
   *         name: scope
   *         schema:
   *           type: string
   *         description: 消息作用域
   *       - in: query
   *         name: to
   *         schema:
   *           type: string
   *         description: 接收者列表 (逗号分隔)
   *       - in: query
   *         name: language
   *         schema:
   *           type: string
   *           default: zh
   *     requestBody:
   *       required: true
   *       content:
   *         audio/*:
   *           schema:
   *             type: string
   *             format: binary
   *     responses:
   *       201:
   *         description: 发布成功，返回消息详情
   */
  app.post(
    '/chat/audio',
    express.raw({ type: () => true, limit: '1mb' }),
    async (req, res, next) => {
      const chat = res.locals.chat as WorldChat,
        actor = res.locals.actor as string;
      const route = {
        scope: req.query.scope,
        recipients:
          typeof req.query.to === 'string' && req.query.to
            ? req.query.to.split(',')
            : [],
      };
      const abort = new AbortController();
      const cancel = () => {
        if (!res.writableEnded) abort.abort();
      };
      res.on('close', cancel);
      let started = false;
      try {
        chat.beginUpload(actor, route);
        started = true;
        const normalized = await speech.normalize(
          Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          req.headers['content-type'] ?? '',
          abort.signal,
        );
        let text = '';
        try {
          text = await scheduleSpeech(speech).transcribe(
            normalized.bytes,
            'audio/wav',
            req.query.language === 'en' ? 'en' : 'zh',
            abort.signal,
          );
        } catch {
          abort.signal.throwIfAborted();
        }
        abort.signal.throwIfAborted();
        chat.authenticate(
          (req.headers.authorization ?? '').replace(/^Bearer /, ''),
        );
        res
          .status(201)
          .json(
            chat.publishAudio(
              actor,
              route,
              normalized.bytes,
              normalized.durationMs,
              text,
            ),
          );
      } catch (e) {
        if (!abort.signal.aborted) next(e);
      } finally {
        if (started) chat.endUpload(actor);
        res.off('close', cancel);
      }
    },
  );

  /**
   * @openapi
   * /chat/spatial/start:
   *   post:
   *     summary: 发起空间语音流
   *     tags:
   *       - Chat
   *     responses:
   *       200:
   *         description: 返回生成的空间语音 session id
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   */
  app.post('/chat/spatial/start', (req, res, next) => {
    try {
      res.json({
        id: (res.locals.chat as WorldChat).beginSpatial(res.locals.actor),
      });
    } catch (e) {
      next(e);
    }
  });

  /**
   * @openapi
   * /chat/spatial/{id}:
   *   delete:
   *     summary: 结束空间语音流
   *     tags:
   *       - Chat
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       204:
   *         description: 已成功结束
   */
  app.delete('/chat/spatial/:id', (req, res) => {
    (res.locals.chat as WorldChat).endSpatial(
      res.locals.actor,
      String(req.params.id),
    );
    res.sendStatus(204);
  });

  /**
   * @openapi
   * /chat/spatial/{id}:
   *   post:
   *     summary: 提交并发布空间语音片段
   *     tags:
   *       - Chat
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         audio/*:
   *           schema:
   *             type: string
   *             format: binary
   *     responses:
   *       200:
   *         description: 成功处理语音片段
   * /chat/spatial/{id}/preview:
   *   post:
   *     summary: 实时预览空间语音转录片段
   *     tags:
   *       - Chat
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         audio/*:
   *           schema:
   *             type: string
   *             format: binary
   *     responses:
   *       200:
   *         description: 实时转录部分结果
   */
  app.post(
    ['/chat/spatial/:id', '/chat/spatial/:id/preview'],
    express.raw({ type: () => true, limit: '1mb' }),
    async (req, res, next) => {
      const chat = res.locals.chat as WorldChat,
        actor = res.locals.actor as string,
        id = String(req.params.id);
      const partial = req.path.endsWith('/preview');
      const abort = new AbortController();
      const cancel = () => {
        if (!res.writableEnded) abort.abort();
      };
      res.on('close', cancel);
      try {
        const signal = AbortSignal.any([
          abort.signal,
          partial
            ? chat.previewSpatial(actor, id)
            : chat.claimSpatial(actor, id),
        ]);
        const text = await scheduleSpeech(speech).transcribe(
          Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          req.headers['content-type'] ?? '',
          'zh',
          signal,
          partial,
        );
        signal.throwIfAborted();
        chat.authenticate(
          (req.headers.authorization ?? '').replace(/^Bearer /, ''),
        );
        if (partial) {
          chat.previewSpatial(actor, id);
          res.json({ text });
        } else res.json(chat.publishSpatial(actor, id, text));
      } catch (e) {
        if (!abort.signal.aborted) next(e);
      } finally {
        if (!partial) chat.endSpatial(actor, id);
        res.off('close', cancel);
      }
    },
  );

  /**
   * @openapi
   * /chat/agent-speech/{id}:
   *   get:
   *     summary: 获取 Agent 语音音频 (WAV)
   *     tags:
   *       - Chat
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: WAV 格式音频
   *         content:
   *           audio/wav:
   *             schema:
   *               type: string
   *               format: binary
   */
  app.get('/chat/agent-speech/:id', (req, res, next) => {
    try {
      const service = getAgentSpeech();
      if (!service) throw new ChatError('Agent 语音服务未就绪。', 503);
      res
        .type('audio/wav')
        .send(service.audio(String(req.params.id), res.locals.actor));
    } catch (e) {
      next(e);
    }
  });

  /**
   * @openapi
   * /chat/audio/{id}:
   *   get:
   *     summary: 获取聊天语音音频 (WAV)
   *     tags:
   *       - Chat
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: WAV 格式音频
   *         content:
   *           audio/wav:
   *             schema:
   *               type: string
   *               format: binary
   */
  app.get('/chat/audio/:id', (req, res, next) => {
    try {
      res
        .type('audio/wav')
        .send(
          (res.locals.chat as WorldChat).audio(
            String(req.params.id),
            res.locals.actor,
          ),
        );
    } catch (e) {
      next(e);
    }
  });
  app.use(
    '/chat',
    errorHandler((e) => ({
      status:
        e instanceof ChatError || e instanceof SpeechError
          ? e.status
          : e.type === 'entity.too.large'
            ? 413
            : 400,
      body: {
        code: e instanceof SpeechError ? e.code : undefined,
        error:
          e instanceof ChatError || e instanceof SpeechError
            ? e.message
            : '无法处理语音消息，请检查输入。',
      },
    })),
  );
}

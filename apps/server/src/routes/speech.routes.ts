import { AsrSettingsStore } from '../audio/asr-settings';
import { listWhisperModels } from '../audio/whisper-settings';
import express, { type Express, type ErrorRequestHandler } from 'express';
import {
  LocalSpeech,
  SpeechError,
  MAX_AUDIO_BYTES,
} from '../audio/local-speech';
import { createVoiceProvider } from '../audio/voice';
import { LocalTts } from '../audio/local-tts';
import { scheduleSpeech } from '../audio/speech-scheduler';
export function installSpeechRoutes(
  app: Express,
  speech = new LocalSpeech(),
  asrSettings = new AsrSettingsStore(),
) {
  const origin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
  app.use('/voice', (req, res, next) => {
    if (
      (origin !== '*' && req.headers.origin && req.headers.origin !== origin) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    ) {
      res.status(403).json({ error: '不允许此页面访问服务器语音服务。' });
      return;
    }
    if (req.headers.origin) {
      res.header(
        'Access-Control-Allow-Origin',
        origin === '*' ? req.headers.origin : origin,
      );
    }
    res.header('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') {
      res.header(
        'Access-Control-Allow-Methods',
        req.path.startsWith('/asr/')
          ? 'GET, POST, PUT, DELETE, OPTIONS'
          : 'GET, POST, OPTIONS',
      );
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      res.status(204).end();
      return;
    }
    next();
  });

  /**
   * @openapi
   * /voice/tts/voices:
   *   get:
   *     summary: 获取本机 TTS 可用音色列表
   *     tags:
   *       - Voice
   *     responses:
   *       200:
   *         description: 音色列表
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   */
  app.get('/voice/tts/voices', async (_req, res) => {
    try {
      res.json(await new LocalTts().voices());
    } catch (error) {
      res.status(error instanceof SpeechError ? error.status : 500).json({
        error:
          error instanceof SpeechError
            ? error.message
            : '无法读取本机音色列表。',
      });
    }
  });

  /**
   * @openapi
   * /voice/capabilities:
   *   get:
   *     summary: 查询当前语音能力与可用模型
   *     tags:
   *       - Voice
   *     parameters:
   *       - in: query
   *         name: serviceId
   *         required: false
   *         schema:
   *           type: string
   *         description: 可选的 ASR 服务 ID
   *     responses:
   *       200:
   *         description: 语音服务支持能力
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 local:
   *                   type: object
   *                 whisperModels:
   *                   type: array
   *                   items:
   *                     type: string
   *                 ollamaConfigured:
   *                   type: boolean
   *                 agentSpeech:
   *                   type: object
   */
  app.get('/voice/capabilities', async (req, res) => {
    try {
      const selected =
        req.query.serviceId === undefined
          ? undefined
          : asrSettings.get(String(req.query.serviceId));
      if (selected && selected.provider !== 'whisper')
        throw new SpeechError('请选择 Whisper 服务。');
      let ollamaConfigured = false;
      try {
        createVoiceProvider('ollama');
        ollamaConfigured = true;
      } catch {
        /* Optional. */
      }
      res.json({
        local: await speech.status(selected),
        whisperModels: await listWhisperModels(),
        ollamaConfigured,
        agentSpeech: await new LocalTts().status(),
      });
    } catch (error) {
      res.status(error instanceof SpeechError ? error.status : 500).json({
        error:
          error instanceof SpeechError ? error.message : '无法检查识别服务。',
      });
    }
  });

  /**
   * @openapi
   * /voice/transcribe:
   *   post:
   *     summary: 上传音频转录为文本
   *     tags:
   *       - Voice
   *     parameters:
   *       - in: query
   *         name: language
   *         schema:
   *           type: string
   *           default: zh
   *         description: 识别语言代码 (如 zh, en)
   *       - in: query
   *         name: serviceId
   *         schema:
   *           type: string
   *         description: 可选指定的 ASR 服务配置 ID
   *       - in: query
   *         name: partial
   *         schema:
   *           type: string
   *           enum: ['0', '1']
   *         description: 是否为流式/部分转录预览
   *     requestBody:
   *       required: true
   *       description: 原始音频二进制流 (Content-Type 对应 audio/wav, audio/webm 等)
   *       content:
   *         audio/*:
   *           schema:
   *             type: string
   *             format: binary
   *     responses:
   *       200:
   *         description: 识别结果文本
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 text:
   *                   type: string
   */
  app.post(
    '/voice/transcribe',
    express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }),
    async (req, res) => {
      const controller = new AbortController();
      const cancel = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on('close', cancel);
      let release: (() => void) | undefined;
      try {
        const selected =
          req.query.serviceId === undefined
            ? undefined
            : asrSettings.acquire(String(req.query.serviceId));
        release = selected?.release;
        if (selected && selected.settings.provider !== 'whisper')
          throw new SpeechError('请选择 Whisper 服务。');
        const text = await scheduleSpeech(speech).transcribe(
          Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          req.headers['content-type'] ?? '',
          String(req.query.language ?? 'zh'),
          controller.signal,
          req.query.partial === '1',
          selected?.settings.provider === 'whisper'
            ? selected.settings
            : undefined,
        );
        if (!controller.signal.aborted) res.json({ text });
      } catch (error) {
        if (!controller.signal.aborted)
          res.status(error instanceof SpeechError ? error.status : 500).json({
            code: error instanceof SpeechError ? error.code : undefined,
            error:
              error instanceof SpeechError
                ? error.message
                : '服务器识别失败，请重试。',
          });
      } finally {
        release?.();
        res.off('close', cancel);
      }
    },
  );
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    res
      .status(error.type === 'entity.too.large' ? 413 : 400)
      .json({ error: '无法读取音频，请使用不超过 5 MiB 的文件。' });
  };
  app.use('/voice', handleError);
}

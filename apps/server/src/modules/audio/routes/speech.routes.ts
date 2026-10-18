import { webOrigin } from '../../../config/env';
import { createOriginGuard } from '../../../common/middleware/cors';
import { errorHandler } from '../../../common/middleware/error-handler';
import { AsrSettingsStore } from '../asr/asr-settings';
import { listWhisperModels } from '../asr/whisper-settings';
import express, { type Express } from 'express';
import { LocalSpeech, MAX_AUDIO_BYTES } from '../asr/local-speech';
import { SpeechError } from '../errors';
import { createVoiceProvider } from '../session/voice';
import { PiperModels } from '../tts/piper-models';
import { scheduleSpeech } from '../tts/speech-scheduler';
export function installSpeechRoutes(
  app: Express,
  speech = new LocalSpeech(),
  asrSettings = new AsrSettingsStore(),
  origin = webOrigin(),
) {
  app.use(
    '/voice',
    createOriginGuard({
      origin,
      required: false,
      crossSite: true,
      message: '不允许此页面访问服务器语音服务。',
      cacheControl: 'no-store',
      methods: (path) =>
        path.startsWith('/asr/')
          ? 'GET, POST, PUT, DELETE, OPTIONS'
          : 'GET, POST, OPTIONS',
    }),
  );

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
        agentSpeech: await new PiperModels().status(),
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
  app.use(
    '/voice',
    errorHandler((error) => ({
      status: error.type === 'entity.too.large' ? 413 : 400,
      body: { error: '无法读取音频，请使用不超过 5 MiB 的文件。' },
    })),
  );
}

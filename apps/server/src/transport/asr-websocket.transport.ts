import type WebSocket from 'ws';
import type { IncomingMessage } from 'node:http';
import { env } from '../config/env';
import { originAllowed } from '../common/origin-policy';
import type { Server } from 'node:http';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { AsrSettingsStore } from '../modules/audio/asr/asr-settings';
import { AppError } from '../common/errors';
import { bridgeBailianAsr } from '../modules/audio/asr/bailian-asr';

/** Shares Colyseus' socket server and heartbeat, dispatching only the explicit ASR path. */
export class AsrWebSocketTransport extends WebSocketTransport {
  closeConnections() {
    for (const client of this.wss.clients) client.terminate();
  }
  constructor(
    server: Server,
    store: AsrSettingsStore,
    bridge = bridgeBailianAsr,
    origin = env.webOrigin(),
    gateway?: (socket: WebSocket, req: IncomingMessage) => void,
  ) {
    super({ server, maxPayload: 32768 });
    let running = 0;
    this.wss.off('connection', this.onConnection);
    this.wss.on('connection', (socket, req) => {
      const client = Object.assign(socket, { pingCount: 0 });
      client.on('pong', () => (client.pingCount = 0));
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/ai-characters/gateway' && gateway) {
        gateway(client, req);
        return;
      }
      if (url.pathname !== '/voice/asr/realtime') {
        void this.onConnection(client, req);
        return;
      }
      client.on('error', () => {});
      const reject = (message: string) => {
        client.send(JSON.stringify({ type: 'error', message }));
        client.close();
      };
      const language = url.searchParams.get('language');
      const serviceId = url.searchParams.get('serviceId');
      try {
        if (!originAllowed(req.headers.origin, origin))
          throw new AppError('不允许此页面访问实时识别。');
        if (running >= 2) throw new AppError('实时识别服务繁忙，请稍后重试。');
        if (language !== 'zh' && language !== 'en')
          throw new AppError('不支持的识别语言。');
        if (!serviceId) throw new AppError('请先选择已保存的识别服务。');
        const { settings, release } = store.acquire(serviceId);
        if (settings.provider === 'whisper') {
          release();
          throw new AppError('Whisper 服务请使用服务器音频识别接口。');
        }
        running++;
        client.once('close', () => {
          running--;
          release();
        });
        bridge(client, settings, language);
      } catch (error) {
        reject(
          error instanceof AppError
            ? error.message
            : '无法启动识别，请检查服务配置。',
        );
      }
    });
  }
}

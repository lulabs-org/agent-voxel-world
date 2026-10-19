import type WebSocket from 'ws';
import type { IncomingMessage } from 'node:http';
import { webOrigin } from '../config/env';
import { originAllowed } from '../common/middleware/cors';
import type { Server } from 'node:http';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { AsrSettingsStore } from '../modules/audio/asr/asr-settings';
import { SpeechError } from '../modules/audio/errors';
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
    origin = webOrigin(),
    gateway?: (socket: WebSocket, req: IncomingMessage) => void,
  ) {
    super({ server, maxPayload: 32768 });
    let running = 0;
    this.wss.off('connection', this.onConnection);
    this.wss.on('connection', (socket, req) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const client = Object.assign(socket, { pingCount: 0 });
      if (url.pathname === '/agents/gateway' && gateway) {
        client.on('pong', () => {
          client.pingCount = 0;
        });
        gateway(client, req);
        return;
      }
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
      if (!originAllowed(req.headers.origin, origin)) {
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

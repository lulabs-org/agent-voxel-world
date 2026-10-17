import type { AsrEvent } from '@voxel/shared';
import { serverSocketUrl } from '../network/endpoints';
import type { LiveSpeechEvents } from './live-speech';
import type { RecordingSession } from './live-recorder';

export class BailianSpeechSession implements RecordingSession {
  readonly ready: Promise<void>;
  private socket: WebSocket;
  private ended = false;
  private started = false;
  private finishing = false;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private timer: ReturnType<typeof setTimeout>;
  constructor(
    serviceId: string,
    language: string,
    private events: LiveSpeechEvents,
    connect = (url: string) => new WebSocket(url),
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.socket = connect(
      `${serverSocketUrl()}/voice/asr/realtime?serviceId=${encodeURIComponent(serviceId)}&language=${language.startsWith('zh') ? 'zh' : 'en'}`,
    );
    this.timer = setTimeout(
      () => this.fail('实时识别连接超时，请检查服务配置。'),
      20000,
    );
    this.socket.onmessage = (event) => {
      if (this.ended) return;
      try {
        const value = JSON.parse(event.data) as AsrEvent;
        switch (value.type) {
          case 'ready':
            this.started = true;
            clearTimeout(this.timer);
            this.resolveReady();
            break;
          case 'partial':
          case 'final':
            if (
              !this.started ||
              typeof value.text !== 'string' ||
              value.text.length > 8000
            )
              throw Error('text');
            if (value.type === 'partial') events.onPartial(value.text);
            else events.onFinal(value.text);
            break;
          case 'finished':
            if (!this.finishing) throw Error('finish');
            this.cancel();
            events.onPartial('');
            events.onEnd();
            break;
          case 'error':
            this.fail(
              typeof value.message === 'string'
                ? value.message
                : '实时识别失败。',
            );
            break;
          default:
            throw Error('event');
        }
      } catch {
        this.fail('实时识别响应无效，请重试。');
      }
    };
    this.socket.onerror = () =>
      this.fail('无法连接实时识别服务，请检查项目服务器。');
    this.socket.onclose = () => {
      if (!this.ended) this.fail('实时识别连接已中断，未确认内容已取消。');
    };
  }
  feed(frame: Uint8Array) {
    if (this.ended || this.finishing || !this.started) return;
    if (this.socket.bufferedAmount > 128000) {
      this.fail('录音上传网络拥堵，请重试。');
      return;
    }
    if (this.socket.readyState !== WebSocket.OPEN) {
      this.fail('实时识别连接已中断。');
      return;
    }
    this.socket.send(frame);
  }
  finish() {
    if (this.ended || this.finishing) return;
    if (!this.started) {
      this.cancel();
      this.events.onEnd();
      return;
    }
    this.finishing = true;
    this.socket.send(JSON.stringify({ type: 'finish' }));
    this.timer = setTimeout(
      () => this.fail('确认最后一句超时，请重试。'),
      20000,
    );
  }
  cancel() {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.timer);
    this.rejectReady(new Error('识别已取消。'));
    this.socket.close();
  }
  private fail(message: string) {
    if (this.ended) return;
    this.cancel();
    this.events.onPartial('');
    this.events.onError(message);
  }
}

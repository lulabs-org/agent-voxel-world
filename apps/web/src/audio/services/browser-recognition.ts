import type { LiveSpeechEvents } from './live-speech';

// SpeechRecognition is not included in TypeScript's standard DOM declarations.
export interface BrowserRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult:
    | ((event: {
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal: boolean }
        >;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionWindow = Window & {
  SpeechRecognition?: new () => BrowserRecognition;
  webkitSpeechRecognition?: new () => BrowserRecognition;
};
const errors: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝，请在浏览器设置中允许后重试。',
  'service-not-allowed':
    '当前浏览器不允许使用语音识别服务，请换用支持的浏览器或选择其他识别服务。',
  'audio-capture': '未找到可用麦克风，请检查设备后重试。',
  network: '浏览器的在线语音识别服务无法连接，请检查网络或选择其他识别服务。',
  'no-speech': '没有听到语音，请重新开始录音。',
  'language-not-supported': '浏览器识别服务不支持所选语言，请切换语言后重试。',
  aborted: '浏览器已中止语音识别，请重新开始录音。',
};

export class BrowserRecognitionSession {
  private recognition?: BrowserRecognition;
  private timer?: ReturnType<typeof setTimeout>;
  private finishing = false;
  constructor(private browser: RecognitionWindow = window) {}
  get available() {
    return !!(
      this.browser.isSecureContext &&
      (this.browser.SpeechRecognition ?? this.browser.webkitSpeechRecognition)
    );
  }
  start(language: string, events: LiveSpeechEvents) {
    this.cancel();
    const Constructor =
      this.browser.SpeechRecognition ?? this.browser.webkitSpeechRecognition;
    if (!this.available || !Constructor) {
      events.onError(
        '当前浏览器不支持 Web Speech API 语音识别。请使用支持的浏览器，并通过 HTTPS 或 localhost 打开。',
      );
      return;
    }
    const recognition = new Constructor();
    this.recognition = recognition;
    this.finishing = false;
    const current = () => this.recognition === recognition;
    const fail = (message: string) => {
      if (!current()) return;
      this.cancel();
      events.onPartial('');
      events.onError(message);
    };
    const confirmed = new Set<number>();
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => {
      if (current() && !this.finishing)
        events.onStatus('正在使用浏览器识别，请开始讲话…');
    };
    recognition.onresult = ({ results }) => {
      if (!current()) return;
      let partial = '';
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          if (!confirmed.has(i)) {
            confirmed.add(i);
            if (text.trim()) events.onFinal(text.trim());
          }
        } else partial += text;
      }
      events.onPartial(partial);
    };
    recognition.onerror = ({ error }) =>
      fail(errors[error] ?? `浏览器语音识别失败（${error}），请重试。`);
    recognition.onend = () => {
      if (!current()) return;
      this.cleanup();
      events.onPartial('');
      events.onEnd();
    };
    this.timer = setTimeout(() => this.finish(), 5 * 60 * 1000);
    // Keep finish failures and timeouts in the same session's error lifecycle.
    this.finishCurrent = () => {
      if (!current() || this.finishing) return;
      this.finishing = true;
      clearTimeout(this.timer);
      events.onStatus('正在等待浏览器确认最后一句…');
      this.timer = setTimeout(
        () => fail('浏览器确认超时，未确认内容已取消，请重试。'),
        10000,
      );
      try {
        recognition.stop();
      } catch {
        fail('无法结束浏览器识别，请重试。');
      }
    };
    try {
      events.onStatus('正在请求麦克风并连接浏览器识别服务…');
      recognition.start();
    } catch {
      fail('无法启动浏览器语音识别，请检查麦克风权限后重试。');
    }
  }
  private finishCurrent?: () => void;
  finish() {
    this.finishCurrent?.();
  }
  cancel() {
    const recognition = this.recognition;
    this.cleanup();
    try {
      recognition?.abort();
    } catch {
      /* Already stopped by the browser. */
    }
  }
  private cleanup() {
    clearTimeout(this.timer);
    if (this.recognition) {
      this.recognition.onstart = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
    }
    this.recognition = undefined;
    this.finishCurrent = undefined;
    this.finishing = false;
  }
}

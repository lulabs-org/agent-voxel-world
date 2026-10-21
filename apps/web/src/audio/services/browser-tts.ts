type Settings = { voice: string; speed: number; voiceLanguage?: string };
let current: { cancel: () => void } | undefined;

export function chooseBrowserVoice(
  voices: SpeechSynthesisVoice[],
  settings: Settings,
  text: string,
) {
  const language =
    settings.voiceLanguage ||
    (/[\u3400-\u9fff]/u.test(text) ? 'zh-CN' : 'en-US');
  const matches = voices.filter(
    (v) =>
      v.lang.toLowerCase().split('-')[0] ===
      language.toLowerCase().split('-')[0],
  );
  return (
    voices.find(
      (v) =>
        v.name === settings.voice &&
        (!settings.voiceLanguage || v.lang === settings.voiceLanguage),
    ) ??
    matches.find((v) => v.lang === language && v.localService) ??
    matches.find((v) => v.localService) ??
    matches[0]
  );
}

/** One browser synthesis queue shared by previews and Agent playback; abort only its owner. */
export function speakBrowserText(
  text: string,
  settings: Settings,
  signal: AbortSignal,
  volume = 1,
): Promise<void> {
  if (!globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance)
    return Promise.reject(Error('当前浏览器不支持 Web Speech API 语音合成。'));
  if (signal.aborted) return Promise.reject(signal.reason);
  current?.cancel();
  return new Promise((resolve, reject) => {
    const synth = globalThis.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = chooseBrowserVoice(synth.getVoices(), settings, text);
    utterance.voice = voice ?? null;
    utterance.lang =
      voice?.lang ||
      settings.voiceLanguage ||
      (/[\u3400-\u9fff]/u.test(text) ? 'zh-CN' : 'en-US');
    utterance.rate = Math.min(2, Math.max(0.5, settings.speed));
    utterance.volume = Math.min(1, Math.max(0, volume));
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      utterance.onend = utterance.onerror = null;
      if (current === owner) current = undefined;
      if (error) reject(error);
      else resolve();
    };
    const owner = {
      cancel: () => {
        finish(new DOMException('朗读已停止。', 'AbortError'));
        synth.cancel();
      },
    };
    const abort = () => {
      if (current === owner) owner.cancel();
    };
    const timer = setTimeout(() => {
      if (current !== owner) return;
      finish(Error('浏览器朗读超时，请重新开启收听或重试。'));
      synth.cancel();
    }, 90000);
    current = owner;
    signal.addEventListener('abort', abort, { once: true });
    utterance.onend = () => finish();
    utterance.onerror = (event) =>
      finish(
        Error(`浏览器朗读失败（${event.error}），请点击试听或重新开启收听。`),
      );
    try {
      synth.speak(utterance);
    } catch {
      finish(Error('无法启动浏览器朗读。'));
    }
  });
}

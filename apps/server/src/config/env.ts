import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const repositoryRoot = fileURLToPath(
  new URL('../../../../', import.meta.url),
);
export const dataPath = (name: string) =>
  resolve(repositoryRoot, '.data', name);
/** Only the executable entrypoint loads dotenv. Importing app/server has no environment side effects. */
export function loadEnvironment() {
  dotenv({ path: resolve(repositoryRoot, '.env') });
  return readServerConfig();
}
export function webOrigin(env = process.env) {
  return env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
}
export function readServerConfig(env = process.env) {
  const port = Number(env.PORT ?? 2567);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw Error('PORT 必须是 0..65535 的整数。');
  const host = env.HOST ?? '127.0.0.1';
  if (!host.trim() || /\s|[/?#]/.test(host))
    throw Error('HOST 必须是有效的监听主机名或地址。');
  const origin = webOrigin(env);
  if (origin !== '*') {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
        throw Error();
    } catch {
      throw Error('WEB_ORIGIN 必须是 HTTP(S) Origin 或 *。');
    }
  }
  const voice = readVoiceConfig(env);
  if (!['mock', 'browser', 'ollama'].includes(voice.provider))
    throw Error('VOICE_PROVIDER 仅支持 mock、browser 或 ollama。');
  return {
    port,
    host,
    webOrigin: origin,
    databaseUrl: env.DATABASE_URL ?? '',
    voice,
    realtime: readRealtimeConfig(env),
  };
}
export type ServerConfig = ReturnType<typeof readServerConfig>;
export function readVoiceConfig(env = process.env) {
  return {
    provider: env.VOICE_PROVIDER ?? 'mock',
    ollamaModel: env.OLLAMA_MODEL ?? '',
    ollamaBaseUrl: env.OLLAMA_BASE_URL,
  };
}
export function readSpeechConfig(env = process.env) {
  return {
    path: env.PATH ?? '',
    whisperModel: env.WHISPER_MODEL,
    whisperBin: env.WHISPER_BIN,
    ffmpegBin: env.FFMPEG_BIN ?? 'ffmpeg',
    whisperApiUrl: env.WHISPER_API_URL,
    speechApiUrl: env.SPEECH_API_URL,
    piperApiUrl: env.PIPER_API_URL,
  };
}
export function readProviderDefaults(env = process.env) {
  return {
    deepseekApiKey: env.DEEPSEEK_API_KEY ?? '',
    deepseekModel: env.DEEPSEEK_MODEL || 'deepseek-flash',
    ollamaModel: env.OLLAMA_MODEL ?? '',
  };
}
export function readRealtimeConfig(env = process.env) {
  return {
    enabled: env.BAILIAN_REALTIME_ENABLED === 'true',
    workspace: env.BAILIAN_WORKSPACE_ID ?? '',
    model: env.BAILIAN_REALTIME_MODEL,
    voice: env.BAILIAN_REALTIME_VOICE,
    credential: () => env.DASHSCOPE_API_KEY ?? '',
  };
}
export function databaseUrl(env = process.env) {
  return env.DATABASE_URL ?? '';
}

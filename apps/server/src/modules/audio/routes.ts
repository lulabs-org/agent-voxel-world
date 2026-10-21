import type { Express, RequestHandler } from 'express';
import { managementBody, managementErrors } from '../management/http';
import type { AsrSettingsStore } from './asr/asr-settings';
import type { LocalSpeech } from './asr/local-speech';
import type { VoiceServiceStore } from './tts/voice-services';
import { installAsrRoutes } from './asr/asr.routes';
import { installTranscribeRoutes } from './asr/transcribe.routes';
import { installCapabilitiesRoutes } from './capabilities.routes';
import { installPiperRoutes } from './tts/piper.routes';
import { installVoiceServiceRoutes } from './tts/voice-services.routes';

/** Audio HTTP composition; stores and cross-domain operations belong to the caller. */
export function installAudioRoutes(
  app: Express,
  deps: {
    origin: string;
    authenticateManagement: RequestHandler;
    speech: LocalSpeech;
    asrSettings: AsrSettingsStore;
    voiceServices: VoiceServiceStore;
    removeVoiceService: (id: string) => Promise<unknown>;
  },
) {
  app.use('/voice/tts', deps.authenticateManagement, ...managementBody);
  app.use('/voice/asr/services', deps.authenticateManagement);

  installCapabilitiesRoutes(app, deps.speech, deps.asrSettings, deps.origin);
  installTranscribeRoutes(app, deps.speech, deps.asrSettings, deps.origin);
  installAsrRoutes(app, deps.asrSettings, deps.origin, true);
  installVoiceServiceRoutes(
    app,
    () => deps.voiceServices,
    deps.removeVoiceService,
  );
  installPiperRoutes(app, deps.voiceServices.piperModels);

  app.use('/voice/tts', (_req, res) => {
    res.status(404).json({ error: '管理接口不存在，请确认前后端版本一致。' });
  });
  app.use('/voice/tts', managementErrors);
}

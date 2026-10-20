import type { GatewayAuth } from './modules/gateway/auth';
import express from 'express';
import type { ServerConfig } from './config';
import type { AgentManager } from './modules/agent';
import type { AsrSettingsStore } from './modules/audio/asr/asr-settings';
import type { LocalSpeech } from './modules/audio/asr/local-speech';
import type { WorldRoom } from './modules/world/room';
import { installAgentRoutes } from './modules/agent';
import { installProviderRoutes } from './modules/providers/providers.routes';
import { installTaskRoutes } from './modules/tasks';
import type { VoiceServiceStore } from './modules/audio/tts/voice-services';
import { installPiperRoutes } from './modules/audio/routes/piper.routes';
import { installVoiceServiceRoutes } from './modules/audio/routes/voice-services.routes';
import {
  managementBody,
  managementErrors,
} from './common/middleware/management-http';
import { installSpeechRoutes } from './modules/audio/routes/speech.routes';
import { installAsrRoutes } from './modules/audio/routes/asr.routes';
import { installChatRoutes } from './modules/chat/chat.routes';
import {
  installWorldRoutes,
  installPresenceRoutes,
} from './modules/world/world.routes';
import { installHealthRoutes } from './routes/health.routes';
import { installDocsRoutes } from './routes/docs.routes';
import { originAllowed } from './common/middleware/cors';
import { errorHandler } from './common/middleware/error-handler';

/** HTTP composition only: no sockets, dotenv, database connections or task timers. */
export function createApp(deps: {
  config: ServerConfig;
  gatewayAuth: GatewayAuth;
  agents: AgentManager;
  voiceServices: VoiceServiceStore;
  speech: LocalSpeech;
  asrSettings: AsrSettingsStore;
  world: () => WorldRoom | undefined;
}) {
  const app = express();
  const origin = deps.config.webOrigin;
  // Preserve permissive public route CORS; protected routes enforce their own policy.
  app.use((req, res, next) => {
    if (req.headers.origin && originAllowed(req.headers.origin, origin, false))
      res.header('Access-Control-Allow-Origin', req.headers.origin);
    next();
  });
  installDocsRoutes(app);
  installHealthRoutes(app, deps.config);
  const managementPaths = [
    '/agents',
    '/providers',
    '/tasks',
    '/task-runs',
    '/voice/tts',
  ];
  app.use(managementPaths, deps.gatewayAuth.middleware, ...managementBody);
  app.use('/voice/asr/services', deps.gatewayAuth.middleware);
  installSpeechRoutes(app, deps.speech, deps.asrSettings, origin);
  installAsrRoutes(app, deps.asrSettings, origin, true);
  installAgentRoutes(app, deps.agents);
  installProviderRoutes(app, {
    store: deps.agents.providers,
    models: (id) => deps.agents.models(id),
    remove: (id) => deps.agents.removeProvider(id),
    changed: () => deps.agents.events.publish('providers'),
  });
  installTaskRoutes(app, deps.agents);
  installVoiceServiceRoutes(
    app,
    () => deps.voiceServices,
    (id) => deps.agents.removeVoiceService(id),
  );
  installPiperRoutes(app, deps.voiceServices.piperModels);
  installWorldRoutes(app, () => deps.world()?.roomId ?? '');
  installChatRoutes(
    app,
    () => deps.world()?.chat,
    deps.speech,
    () => deps.world()?.agentSpeech,
    origin,
  );
  installPresenceRoutes(app, () => deps.world()?.getPresence(), origin);
  app.use(managementPaths, (_req, res) => {
    res.status(404).json({ error: '管理接口不存在，请确认前后端版本一致。' });
  });
  app.use(managementPaths, managementErrors);
  app.use(errorHandler());
  return app;
}

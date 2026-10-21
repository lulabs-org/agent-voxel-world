import cors from 'cors';
import { ManagementCommands } from './modules/management/commands';
import { installManagementRoutes } from './modules/management/routes';
import { taskCommandBody } from './modules/tasks/command-policy';
import type { GatewayAuth } from './modules/gateway/auth';
import express from 'express';
import type { ServerConfig } from './config';
import type { AICharacterManager } from './modules/ai-characters';
import type { AsrSettingsStore } from './modules/audio/asr/asr-settings';
import type { LocalSpeech } from './modules/audio/asr/local-speech';
import type { WorldRoom } from './modules/world/room';
import { installAICharacterRoutes } from './modules/ai-characters';
import { installProviderRoutes } from './modules/providers/providers.routes';
import { installTaskRoutes } from './modules/tasks';
import type { VoiceServiceStore } from './modules/audio/tts/voice-services';
import { installAudioRoutes } from './modules/audio/routes';
import { managementBody, managementErrors } from './modules/management/http';
import { installChatRoutes } from './modules/chat/chat.routes';
import {
  installWorldRoutes,
  installPresenceRoutes,
} from './modules/world/world.routes';
import { installHealthRoutes } from './routes/health.routes';
import { installDocsRoutes } from './routes/docs.routes';
import { originAllowed } from './common/origin-policy';
import { errorHandler } from './common/middleware/error-handler';

/** HTTP composition only: no sockets, dotenv, database connections or task timers. */
export function createApp(deps: {
  config: ServerConfig;
  gatewayAuth: GatewayAuth;
  characters: AICharacterManager;
  voiceServices: VoiceServiceStore;
  speech: LocalSpeech;
  asrSettings: AsrSettingsStore;
  world: () => WorldRoom | undefined;
}) {
  const app = express();
  const commands = new ManagementCommands(taskCommandBody);
  const modelCatalog = deps.characters.modelCatalog;
  const origin = deps.config.webOrigin;
  const publicCors = cors({
    origin: (requestOrigin, callback) =>
      callback(
        null,
        !!requestOrigin && originAllowed(requestOrigin, origin, false),
      ),
  });
  // Public responses get CORS headers; each route owns its preflight after origin checks.
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') next();
    else publicCors(req, res, next);
  });
  installDocsRoutes(app);
  installHealthRoutes(app, deps.config);
  const managementPaths = [
    '/ai-characters',
    '/providers',
    '/tasks',
    '/task-runs',
    '/management',
  ];
  app.use(managementPaths, deps.gatewayAuth.middleware, ...managementBody);
  installAudioRoutes(app, {
    origin,
    authenticateManagement: deps.gatewayAuth.middleware,
    speech: deps.speech,
    asrSettings: deps.asrSettings,
    voiceServices: deps.voiceServices,
    removeVoiceService: (id) => deps.characters.removeVoiceService(id),
  });
  installAICharacterRoutes(app, deps.characters, commands);
  installProviderRoutes(
    app,
    {
      store: deps.characters.providers,
      models: (id) => modelCatalog.models(id),
      remove: (id) => deps.characters.removeProvider(id),
      changed: () => deps.characters.events.publish('providers'),
    },
    commands,
  );
  installTaskRoutes(app, deps.characters.tasks, commands);
  installManagementRoutes(app, commands);
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

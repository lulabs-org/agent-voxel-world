import type { GatewayAuth } from './modules/gateway/auth';
import express from 'express';
import type { ServerConfig } from './config';
import type { AgentManager } from './modules/agent';
import type { AgentGateway } from './modules/gateway/gateway';
import type { AsrSettingsStore } from './modules/audio/asr/asr-settings';
import type { LocalSpeech } from './modules/audio/asr/local-speech';
import type { WorldRoom } from './modules/world/room';
import { installGatewayRoutes } from './modules/gateway/http.routes';
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
  gateway?: AgentGateway;
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
  app.use('/agents', deps.gatewayAuth.middleware);
  app.use('/voice/asr/services', deps.gatewayAuth.middleware);
  installSpeechRoutes(app, deps.speech, deps.asrSettings, origin);
  installAsrRoutes(app, deps.asrSettings, origin, true);
  installGatewayRoutes(app, deps.gateway ?? deps.agents, origin, true);
  installWorldRoutes(app, () => deps.world()?.roomId ?? '');
  installChatRoutes(
    app,
    () => deps.world()?.chat,
    deps.speech,
    () => deps.world()?.agentSpeech,
    origin,
  );
  installPresenceRoutes(app, () => deps.world()?.getPresence(), origin);
  app.use(errorHandler());
  return app;
}

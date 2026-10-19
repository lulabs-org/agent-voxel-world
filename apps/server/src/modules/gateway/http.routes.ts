import express, { type Express } from 'express';
import type { AgentGateway } from './gateway';
import type { AgentManager } from '../agent/manager';
import { SpeechError } from '../audio/errors';
import { installVoiceServiceRoutes } from '../audio/routes/voice-services.routes';
import { installProviderRoutes } from '../providers/routes/providers.routes';
import { installAgentRoutes } from '../agent/routes/agents.routes';
import { installTaskRoutes } from '../tasks/routes/tasks.routes';
import { createOriginGuard } from '../../common/middleware/cors';
import { requireJsonBody } from '../../common/middleware/json-body';
import { errorHandler } from '../../common/middleware/error-handler';
import { webOrigin } from '../../config/env';

/**
 * 汇聚装配 Providers、Agents、Tasks 的 HTTP REST 路由
 */
export function installGatewayHttp(app: Express, g: AgentGateway) {
  installProviderRoutes(app, g);
  installAgentRoutes(app, g);
  installTaskRoutes(app, g);
}

export function installGatewayRoutes(
  app: Express,
  manager: AgentManager,
  origin = webOrigin(),
  authenticated = false,
) {
  app.use(
    '/agents',
    ...(authenticated
      ? []
      : [
          createOriginGuard({
            origin,
            message: '仅允许配置的本机游戏页面管理 Agent。',
            vary: true,
            alwaysHeader: true,
            cacheControl: 'no-store',
            methods: 'GET, POST, PUT, DELETE, OPTIONS',
          }),
        ]),
    requireJsonBody,
    express.json({ limit: '32kb' }),
  );

  // Fixed resource paths must precede parameterized Agent paths. Keep the public URLs.
  installVoiceServiceRoutes(
    app,
    () => manager.voiceServices,
    (id) => manager.removeVoiceService(id),
  );

  installGatewayHttp(app, manager.gateway);

  app.use('/agents', (_req, res) => {
    res.status(404).json({ error: 'Agent 接口不存在，请确认前后端版本一致。' });
  });

  app.use(
    '/agents',
    errorHandler((error) => ({
      status:
        error instanceof SpeechError
          ? error.status
          : error.type === 'entity.too.large'
            ? 413
            : error instanceof SyntaxError
              ? 400
              : 500,
      body: {
        error:
          error instanceof SpeechError
            ? error.message
            : '无法处理请求，请检查输入或本机配置文件权限。',
      },
    })),
  );
}

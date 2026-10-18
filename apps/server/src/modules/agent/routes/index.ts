import express, { type Express } from 'express';
import type { AgentManager } from '../manager';
import { ManagementError, TaskPlanError } from '../errors';
import { SpeechError } from '../../audio/errors';
import { installVoiceServiceRoutes } from '../../audio/routes/voice-services.routes';
import { installAgentProviderRoutes } from './agent-providers.routes';
import { installAgentTaskRoutes } from './agent-tasks.routes';
import { installAgentCrudRoutes } from './agent.routes';
import { createOriginGuard } from '../../../common/middleware/cors';
import { requireJsonBody } from '../../../common/middleware/json-body';
import { errorHandler } from '../../../common/middleware/error-handler';
import { webOrigin } from '../../../config/env';

export function installAgentRoutes(
  app: Express,
  manager: AgentManager,
  origin = webOrigin(),
) {
  app.use(
    '/agents',
    createOriginGuard({
      origin,
      message: '仅允许配置的本机游戏页面管理 Agent。',
      vary: true,
      alwaysHeader: true,
      cacheControl: 'no-store',
      methods: 'GET, POST, PUT, DELETE, OPTIONS',
    }),
    requireJsonBody,
    express.json({ limit: '32kb' }),
  );
  // Fixed resource paths must precede parameterized Agent paths. Keep the public URLs.
  installVoiceServiceRoutes(
    app,
    () => manager.voiceServices,
    (id) => manager.removeVoiceService(id),
  );
  installAgentProviderRoutes(app, manager);
  installAgentTaskRoutes(app, manager);
  installAgentCrudRoutes(app, manager);
  app.use('/agents', (_req, res) => {
    res.status(404).json({ error: 'Agent 接口不存在，请确认前后端版本一致。' });
  });
  app.use(
    '/agents',
    errorHandler((error) => ({
      status:
        error instanceof ManagementError ||
        error instanceof SpeechError ||
        error instanceof TaskPlanError
          ? error.status
          : error.type === 'entity.too.large'
            ? 413
            : error instanceof SyntaxError
              ? 400
              : 500,
      body: {
        error:
          error instanceof ManagementError ||
          error instanceof SpeechError ||
          error instanceof TaskPlanError
            ? error.message
            : '无法处理请求，请检查输入或本机配置文件权限。',
      },
    })),
  );
}

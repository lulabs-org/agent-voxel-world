import express, { type Express } from 'express';
import type { AgentGateway } from './gateway';
import type { AgentManager } from '../agent';
import { AppError } from '../../common/errors';
import { installVoiceServiceRoutes } from '../audio/routes/voice-services.routes';
import { installProviderRoutes } from '../providers/providers.routes';
import { installAgentRoutes } from '../agent';
import { installTaskRoutes } from '../tasks/tasks.routes';
import { createOriginGuard } from '../../common/middleware/cors';
import { requireJsonBody } from '../../common/middleware/json-body';
import { errorHandler } from '../../common/middleware/error-handler';
import { env } from '../../config/env';
import { identifier, publicError } from '@voxel/gateway-protocol';

/**
 * 汇聚装配 Providers、Agents、Tasks 的 HTTP REST 路由
 */
export function installGatewayHttp(
  app: Express,
  managerOrGateway: AgentManager | AgentGateway,
) {
  const manager =
    'target' in managerOrGateway
      ? (managerOrGateway.target as AgentManager)
      : managerOrGateway;
  installProviderRoutes(app, manager);
  installAgentRoutes(app, manager);
  installTaskRoutes(app, manager);
}

export function installGatewayRoutes(
  app: Express,
  managerOrGateway: AgentManager | AgentGateway,
  origin = env.webOrigin(),
  authenticated = false,
) {
  const manager =
    'target' in managerOrGateway
      ? (managerOrGateway.target as AgentManager)
      : managerOrGateway;
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
    (req, res, next) => {
      const key = req.header('Idempotency-Key');
      if (key !== undefined && !identifier(key)) {
        res.status(400).json({ error: 'Idempotency-Key 无效。' });
        return;
      }
      next();
    },
    requireJsonBody,
    express.json({ limit: '32kb' }),
  );

  // Fixed resource paths must precede parameterized Agent paths. Keep the public URLs.
  installVoiceServiceRoutes(
    app,
    () => manager.voiceServices,
    (id) => manager.removeVoiceService(id),
  );

  installGatewayHttp(app, manager);

  app.use('/agents', (_req, res) => {
    res.status(404).json({ error: 'Agent 接口不存在，请确认前后端版本一致。' });
  });

  app.use(
    '/agents',
    errorHandler((error) => {
      if (error instanceof AppError) {
        return { status: error.status, body: { error: error.message } };
      }
      if (error?.type === 'entity.too.large') {
        return {
          status: 413,
          body: { error: '无法处理请求，请检查输入或本机配置文件权限。' },
        };
      }
      if (error instanceof SyntaxError) {
        return {
          status: 400,
          body: { error: '无法处理请求，请检查输入或本机配置文件权限。' },
        };
      }
      const e = publicError(error);
      return { status: e.status, body: { error: e.message } };
    }),
  );
}

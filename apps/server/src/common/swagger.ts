import swaggerJsdoc from 'swagger-jsdoc';
import { apiSchemas } from './openapi-schemas';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Agent Voxel World API',
      version: '1.0.0',
      description: 'API documentation for Agent Voxel World Server',
    },
    servers: [{ url: '/', description: '当前服务器' }],
    tags: [
      { name: 'System', description: '服务状态' },
      { name: 'World', description: '世界与在线状态' },
      { name: 'Agents', description: 'Agent 配置、生命周期和角色级操作' },
      { name: 'Providers', description: '共享 LLM 提供商配置与模型目录' },
      { name: 'Tasks', description: '全局任务计划、指派和调度' },
      { name: 'Task Runs', description: '具体执行运行的控制' },
      { name: 'TTS', description: '共享语音合成服务配置与试听' },
      { name: 'TTS Models', description: 'Piper 模型目录与安装' },
      { name: 'ASR', description: '语音识别服务配置' },
      { name: 'Voice', description: '语音能力查询和音频转录' },
      { name: 'Chat', description: '聊天音频、空间语音与听众访问权限' },
    ],
    components: {
      securitySchemes: {
        ManagementBearer: {
          type: 'http',
          scheme: 'bearer',
          description:
            '管理员令牌；用于 Agents、Providers、Tasks、TTS 和 ASR 配置管理。',
        },
        ChatBearer: {
          type: 'http',
          scheme: 'bearer',
          description: '加入世界后通过 chat.auth 获得的玩家会话令牌。',
        },
      },
      schemas: apiSchemas,
      responses: Object.fromEntries(
        Object.entries({
          400: '参数、JSON 或操作无效',
          401: '需要管理员令牌',
          403: 'Origin 不被允许',
          404: '资源不存在',
          409: '资源状态冲突',
          413: 'JSON 超过 32 KiB',
          415: '请求须为 JSON',
        }).map(([status, description]) => [
          `Management${status}`,
          {
            description,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
        ]),
      ),
    },
  },
  apis: [
    path.join(__dirname, '..', 'routes', '**', '*.routes.ts'),
    path.join(__dirname, '..', 'modules', '**', '*.routes.ts'),
    path.join(__dirname, '..', 'modules', '**', 'routes.ts'),
  ],
};

export const swaggerSpec = swaggerJsdoc(options);

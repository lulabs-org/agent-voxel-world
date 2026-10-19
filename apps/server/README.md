# 服务端架构

`index.ts` 是唯一自动加载仓库 `.env` 的入口，负责启动与 SIGINT/SIGTERM 处理。导入 `app.ts` 或 `server.ts` 不会监听端口或加载 `.env`。

## 装配与生命周期

- `createApp` 接收配置和领域依赖，仅装配 Express 中间件及路由，不创建数据库连接或网络监听器。
- `createServer` 检查数据库配置、加载本地服务配置并装配 Agent、世界、HTTP 和 WebSocket。`listen()` 绑定端口、创建世界，然后恢复 Agent；端口为 0 时，内部 Agent 连接使用实际分配的端口。
- `close()` 可重复调用。先关闭 Agent 与 Colyseus 房间，再终止 ASR WebSocket、HTTP/SSE 连接并释放存储；启动失败也走同一清理路径。
- 仍为单进程单世界模型。Colyseus 的 matchMaker 与房间占用状态属于进程；不要在同一进程同时创建多个服务器。测试中的多个世界应顺序关闭后再创建，或放在独立进程中。
- PostgreSQL 启动与迁移继续由开发者显式执行。配置了数据库但不可用时给出诊断和恢复命令，不自动启动数据库；未配置时使用带警告的内存世界。

## 依赖方向

`config` 和 `common` 不引用业务领域；`modules` 不反向引用 `app.ts`、`server.ts`、入口或 `transport`。跨领域只依赖实际使用的具体文件，少量装配入口才使用 `index.ts`，避免大范围重导出。

| 目录                    | 责任                                                         |
| ----------------------- | ------------------------------------------------------------ |
| `config`                | 类型化配置、部署变量校验、`.env` 加载与数据路径              |
| `common`                | `AppError`、异步路由、请求体、Origin 机制、异常响应、Swagger |
| `transport`             | Gateway、ASR 与 Colyseus WebSocket 路径分发和关闭            |
| `modules/agent`         | 生产依赖注入、Agent/模型配置文件适配、世界内语音投递         |
| `modules/gateway`       | 管理令牌、WebSocket RPC、HTTP 兼容路由与 OpenAPI 契约        |
| `modules/audio/asr`     | 本地 Whisper、百炼识别及 ASR 配置                            |
| `modules/audio/tts`     | Piper、本地/远程合成、音色服务及合成队列                     |
| `modules/audio/session` | mock/browser/Ollama 语音会话状态                             |
| `modules/chat`          | 消息、附件、音频票据及私聊权限                               |
| `modules/realtime`      | 百炼实时会话、工具确认与离线协议模拟器                       |
| `modules/world`         | 权威物理房间、Schema、世界持久化与在线状态 SSE               |

`local-speech.ts` 属于识别流程，保留在 `asr`。Piper 模型和声音服务的管理路由归 `audio`，HTTP 地址继续为 `/agents/voice-services`；Agent 音色绑定由 Agent 管理器处理，删除服务通过注入回调检查绑定，音频模块不反向依赖 Agent。`agent-storage.ts` 留在 `agent` 模块，`provider-store.ts` 归属 `providers` 模块。

共享托管业务错误来自 `@voxel/agent-gateway`；服务器音频和聊天错误留在所属领域，继承通用 `AppError`。复用 Origin 判断和异常处理机制不意味着统一所有端点的策略：保留语音接口允许无 Origin、管理接口的 Origin 校验、原有预检方法、JSON/原始音频限制以及错误状态和文案。Swagger 递归扫描 `routes` 和 `modules` 下的 `*.routes.ts`。

Agent 托管集合、调度、任务操作和日志位于 `packages/agent-gateway`。`modules/agent/manager.ts` 仅注入生产依赖；该目录不保留共享包的转导出文件。HTTP 装配、接口注释与命令分发统一放在 `modules/gateway/http.routes.ts`。

Agent 共用运行时继续位于 `packages/agent-runtime`，不迁入服务端。服务端与 CLI 都通过 `AgentRunner.run()` 进入统一协调器；对话、任务服务和任务执行使用独立职责，CLI 的 `runAgent` 保留自身调度循环。

## 状态与测试

`dataPath()` 锚定仓库根目录；模型服务、Agent 任务、ASR 设置、音色与模型缓存继续保存在原 `.data/` 位置，Docker 中仍为 `/app/.data/`。无数据格式或迁移变更。

`test/helpers/test-server.ts` 使用生产 `createServer`，默认配置临时目录、内存世界、随机 loopback 端口、mock 语音和禁用云端实时会话。调用方可注入模型运行器、存储和语音依赖；`close()` 清理工厂拥有的临时目录，调用方提供的目录由调用方负责。默认 fixture key 不可用于真实推理。

```sh
pnpm --filter @voxel/server test  # 服务端就近测试与网络生命周期
pnpm check                       # 全仓类型、单元测试和构建
pnpm test:agents
pnpm test:agent:tasks
pnpm test:navigation
pnpm test:chat
pnpm test:voice:live
pnpm test:agent:voice
pnpm test:voice:services
pnpm test:agent:deepseek
pnpm test:player:names
pnpm --filter @voxel/server exec tsx test/integration/realtime.ts
```

以上推理/语音集成默认使用固定响应，仍通过真实 HTTP、WebSocket 与物理执行。真实模型导航需显式运行 `NAVIGATION_PROVIDERS=/absolute/path/providers.json pnpm test:navigation:live`；测试不会自动读取生产凭据，也不修改当前开发世界。结果默认写入 `artifacts/navigation-live-model.json`。

`tests/server-boundaries.test.ts` 检查依赖方向、循环依赖、配置入口和集成装配。生命周期测试检查 HTTP 契约、SSE/ASR/世界连接关闭、失败启动后的再次启动。Vitest 使用线程池，避免 Colyseus 的 PM2 遥测占用 fork 的测试 IPC，不模拟服务器本身。

UI 沙箱统一放在 `test/sandbox`。新增 `asr-services-fixture.ts` 提供确定性识别结果与临时配置；仓库没有可迁移的受控 `output/asr-services-fixture.ts`。三个沙箱均通过 `createTestServer` 启动，并处理退出清理。

## 独立任务计划存档

任务计划、执行历史和调度规则由 `packages/agent-gateway/src/plans` 管理；`wake-scheduler.ts` 只推进 Agent 消息唤醒、等待检查和本地跟随。服务端保留文件和 HTTP/WebSocket 适配，不拥有第二套计划集合或调度器。

同一 Agent JSON 路径保存 Gateway v1 的 agents/plans/runs/requests 聚合对象，runtime 仍为 v2。升级前独占创建 `.before-task-plan-module-v1.bak`，迁移与保存成功后才能启动恢复。删除角色保留计划与执行历史；聊天执行没有 planId。部署与回滚流程见 [Agent Gateway](../../docs/AGENT_GATEWAY.md)。

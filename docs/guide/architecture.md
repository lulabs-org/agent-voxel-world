# 项目架构与代码组织

本文档详细说明 Agent Voxel World 的整体架构、前后端模块分层、目录组织及系统设计边界。

## 范围与限制

这是本地单进程、单世界、最多 16 会话的原型系统，不是完整的 Minecraft。

- **体素世界**：地形尺寸为 25×25，垂直高度上限 15。方块编辑持久化（支持 PostgreSQL 或内存回退）；玩家位置、聊天消息、事件和语音会话暂不落盘持久化。
- **玩法机制**：当前没有背包、合成、战斗、账户鉴权、反作弊运营、多人分片或生产部署设计。
- **事件机制**：事件环形缓存保留最近 100 条，观察接口返回最近 30 条当前会话有权接收的事件。
- **Agent 观察视野**：以 Agent 自身为中心半径 8 的距离裁剪，最多返回 500 个最近方块，不做遮挡/视锥裁剪；这是结构化场景数据接口，并非模型视觉。
- **校验对齐**：Agent 与人类玩家共用完全一致的服务端移动和方块编辑校验。Scout 脚本 Agent 没有 LLM；DeepSeek AI 玩家由大模型决策，两者均没有任何额外管理员特权。协议细节请参考 [协议与扩展边界](../protocol/overview)。
- **语音集成**：语音方案支持 `mock`、`browser` 和 `ollama`。回声不是 AI；Ollama 需预先安装并配置。聊天语音识别由服务端 Whisper 处理，控制台另支持阿里云百炼实时 ASR 试用和云端 TTS。云端凭据仅保存在服务端，严禁放入前端 `VITE_*`。

## Monorepo 目录结构

项目基于 pnpm workspace 管理：

- `apps/web`：按 feature 拆分的 React UI、Three.js 实例化体素渲染、位置插值与重连机制。详见 [Web 架构](../../apps/web/README.md)。
- `apps/server`：Colyseus 单一权威世界、事务持久化存储、语音 Provider 接口及 Agent 调度管理。详见 [服务端架构](../../apps/server/README.md)。
- `apps/server/prisma`：PostgreSQL schema 与可重放迁移脚本。
- `packages/shared`：前后端共用的网络协议、确定性地形生成、物理计算与移动/放置合法性校验。
- `packages/agent-runtime`：CLI 与服务端共用的 Agent 会话客户端、动作执行、模型规划和任务运行时，通过 `@voxel/agent-runtime` 导入引用。详见 [统一运行时](../agent/runtime)。
- `scripts/agent`：脚本测试机器人（Scout）、独立 AI 玩家与管理命令行入口，保留所有 `pnpm agent:*` 命令。
- `docs`：基于 VitePress 构建的完整文档站点。

---

## 服务端架构 (`apps/server`)

服务端按领域（Domain-Driven）组织，HTTP 装配与网络生命周期分离，生产和集成测试共用同一套服务器工厂。

```text
apps/server/
├── prisma/                 # schema 与 migrations
├── src/
│   ├── index.ts            # 环境加载、监听与信号处理
│   ├── app.ts              # createApp：HTTP 路由装配
│   ├── server.ts           # createServer：依赖、房间与连接生命周期
│   ├── config/             # 环境配置、校验与稳定的数据路径
│   ├── common/             # 通用错误、校验、命令队列与 Origin 判断
│   ├── http/               # HTTP 装配、中间件、管理策略、健康检查与文档路由
│   ├── openapi/            # OpenAPI schema 与 Swagger 扫描
│   ├── transport/          # Socket 路由类型与 Gateway / ASR / Colyseus 分发
│   ├── persistence/        # 角色与任务联合存档、迁移和提交
│   └── modules/
│       ├── ai-characters/  # 角色生命周期、唤醒、执行与配置
│       ├── providers/      # 模型提供商配置与模型目录
│       ├── tasks/          # 任务计划、调度、执行控制与历史
│       ├── management/     # 管理命令回执、错误与事件
│       ├── gateway/        # 管理令牌与 WebSocket 通知
│       ├── audio/          # asr、tts、session 与音频路由
│       ├── chat/           # 聊天、附件、票据与 HTTP 路由
│       ├── realtime/       # 实时会话、百炼适配器与离线协议模拟器
│       └── world/          # 权威房间、Schema、存储与世界路由
└── test/
    ├── helpers/            # createTestServer：隔离状态的生产装配
    ├── integration/        # 独立临时世界中的集成脚本
    └── sandbox/            # 独立沙盒启动入口
```

### 服务端生命周期

- `createApp`：接收按用途分组的 HTTP 依赖（health、management、audio、world、chat），仅装配 Express 中间件及路由，不创建数据库连接或网络监听器。世界房间 ID、presence 和聊天能力通过延迟访问函数注入。
- `createServer`：检查数据库配置、加载本地服务配置并装配 Agent、世界、HTTP 和 WebSocket。`listen()` 绑定端口、创建世界，然后恢复 Agent。
- `close()`：可重复安全调用。先关闭 Agent 与 Colyseus 房间，再终止 ASR WebSocket、HTTP/SSE 连接并释放存储；启动失败也走同一清理路径。

---

## 前端架构 (`apps/web`)

前端按“功能特性（Feature）”与“基础设施（Infrastructure）”划分组织：

```text
apps/web/src/
├── main.tsx                # React 挂载与单个世界连接的热更新清理
├── App.tsx                 # 大厅、游戏场景与面板装配
├── features/
│   ├── console/            # 控制台、表单、任务卡片、状态控制器与 API
│   ├── chat/               # 消息、选人、录音草稿、状态控制器与 API
│   ├── voice/              # 语音面板、能力查询与实时语音样式
│   └── world/              # 在线玩家面板
├── graphics/               # Three.js 场景、角色与名称牌
├── audio/                  # 采集、播放、转写及 PCM Worklet
├── network/                # 服务地址、连接与在线状态订阅
└── styles/                 # 全局样式
```

### 设计与协作规范

1. **HTTP 请求隔离**：各功能的 HTTP 请求由对应 `features/*/api.ts` 管理；通用 HTTP/WebSocket 地址统一从 `network/endpoints.ts` 解析。音频基础设施保留自身的流处理与请求取消逻辑，组件不得直接从录音模块获取服务地址或发起裸请求。
2. **状态控制器**：控制台状态由 `useConsoleController` 统一持有，表单和任务卡片通过参数与回调交互；语音面板在切换分类或关闭控制台时保持挂载。`useChatController` 管理选人、录音与发送状态，并在断线或卸载时清理采集与上传。
3. **音频 Worklet**：`pcm-worklet.js` 与加载它的 `realtime-audio.ts` 同目录，保证浏览器与打包环境均能正确寻址。
4. **编译与边界**：开发、独立预览与根目录测试继续使用相对导入，不强制要求路径别名。`output/`、`dist/` 和 `node_modules/` 不参与源码类型检查；历史临时验收文件不属于正式源码。

---

## 测试与验证体系

全仓测试分为多个层次，保证从单元到多客户端网络链路的可靠性：

### 快速校验命令

```sh
pnpm check             # 全仓 ESLint、类型、单元及 DOM 回归测试、所有应用构建
pnpm lint              # 检查应用、共享包、脚本、测试和配置文件
pnpm lint:fix          # 自动修复全仓可修复的 lint 问题
pnpm test:integration  # 随机端口、临时存档中的世界协议集成测试
pnpm format:check      # Prettier 代码格式检查
```

### 测试层次说明

- **代码规范**：ESLint 由根目录 `eslint.config.js` 统一配置，`apps/server`、`apps/web`、`packages/agent-runtime` 和 `packages/shared` 也可通过 `pnpm --filter <包名> lint` 单独检查。TypeScript 开启了严格规则与 Promise 浮空检查；前端增加了 Hooks 调用顺序与依赖检查。
- **协议集成测试 (`pnpm test:integration`)**：在随机端口和临时存档中启动两个 SDK 玩家和一个脚本 Agent，验证并发编辑互斥、三方状态同步、非法动作服务端拒绝、聊天广播与私聊、断线恢复、持久化模式及 mock 字幕打断。
- **领域集成脚本**：
  - `pnpm test:voice:services`、`pnpm test:agents`、`pnpm test:chat`、`pnpm test:agent:voice`、`pnpm test:agent:tasks` 和 `pnpm test:agent:deepseek` 指向服务端集成脚本，使用隔离世界和固定模型响应。
  - `pnpm test:navigation:live`：需要显式提供模型配置，验收 Agent 真实模型调用下的寻路、绕障与持续跟随任务。详细报告请参考 [验证记录](../changelog/validation)。

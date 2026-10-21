# 快速开始

## 环境要求

- Node 22.13+
- pnpm 10
- PostgreSQL 17 二进制

macOS 默认使用 `/opt/homebrew/opt/postgresql@17/bin`，其他路径通过 `PG_BIN` 指定。无需 Docker 或云账号。

## 本地开发

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:start
pnpm db:migrate
pnpm dev
# 另一个终端（运行 AI 玩家或测试机器人）：
pnpm agent:ai    # 或运行无 AI 的测试机器人：pnpm agent:mock
```

打开 http://127.0.0.1:5173，用两个独立浏览器上下文输入不同昵称进入。服务只绑定 `127.0.0.1:2567`。

::: info 数据库初始化
`pnpm db:start` 只在本项目 `.data/postgres` 初始化数据库，在端口 55432 启动，创建被 Git 忽略的 `.env`，绝不覆盖已有 `.env`。端口被占用或数据目录没有项目标记时拒绝启动。开发用凭据仅适用于本地测试。
:::

停止前端/服务端用 `Ctrl+C`；停止独立数据库用 `pnpm db:stop`。再次 `pnpm db:start` 使用原数据。

::: warning 注意
不要删除 `.data`，除非有意丢弃这个原型的世界。
:::

### 内存模式与数据库故障

- **内存模式**：如果没有配置 `DATABASE_URL`，服务器明确进入 `memory` 模式。刷新页面仍读取活跃房间，但服务重启会丢失方块编辑。
- **启动检查**：`pnpm dev` 不会自动启动数据库。后端会在监听端口前检查数据库连接及世界表。配置了数据库但连接失败时直接报错退出，绝不悄悄切成内存模式。Vite 显示 `ready` 仅表示前端就绪，后端未就绪时无法进入世界。

### 常见问题与解决

| 错误提示 / 现象 | 原因分析 | 解决方法 |
|---------|--------|--------|
| 无法连接 `127.0.0.1:55432` | 独立 PostgreSQL 数据库未启动 | 手动运行 `pnpm db:start`，然后重启 `pnpm dev` |
| 提示表结构未准备好 | 数据库尚未执行 Prisma 迁移 | 确认数据库配置后运行 `pnpm db:migrate` |
| 控制台警告内存模式 | 未设置 `DATABASE_URL` | 如需持久化，运行 `pnpm db:start` 并配置 `.env` |

## Docker 容器化部署

本项目支持使用 Docker Compose 进行一键全栈容器化部署，包含 PostgreSQL 17 数据库、Node 后端服务（自动执行迁移并启动 Colyseus/Express）以及 Web 前端（Nginx 静态托管与统一反向代理）。

### 一键启动

```sh
# 使用 pnpm 快捷脚本
pnpm docker:up

# 或直接使用 Docker Compose 原生命令
docker compose up -d --build
```

启动完成后：

- **Web 前端**：打开浏览器访问 `http://localhost`（默认 80 端口，前端通过 Nginx 自动反代 API 与 WebSocket）
- **Swagger API 文档**：访问 `http://localhost:2567/api-docs`
- **数据库**：PostgreSQL 数据自动持久化在 `voxel_postgres_data` 数据卷中，宿主机端口 `55432`
- **语音服务 ASR / TTS**：内置共享 `voxel-speech`（Speaches，Compose 服务名 `speech`）容器，CPU 使用 int8 推理，模型缓存在 `voxel_whisper_cache` 卷中。Whisper 首次识别需要联网下载模型，下载后可离线识别；模型加载后常驻内存，避免空闲后重复冷启动。
- **Piper TTS**：控制台选择中文 Huayan / 超文 Chaowen 或英文 Lessac，点击“安装模型”，安装后可离线合成。旧 macOS 服务自动迁移，保留 Agent 绑定；原配置备份为 `voice-services.json.pre-piper.bak`。
- **服务配置**：模型、ASR 与 TTS 配置保存在 `voxel_server_data` 卷中，重建容器会保留。旧部署升级前，请先备份旧容器的 `/app/.data` 并迁入该卷。

### 浏览器麦克风与音频权限

录音需要允许浏览器和系统的麦克风权限：
- 必须通过本机 `http://localhost` 或配置了合法证书的 HTTPS 访问；局域网普通 HTTP 地址无法使用麦克风（受浏览器安全上下文限制）。
- 若内置浏览器一直等待授权，可在 Chrome 或 Edge 打开同一地址，或在控制台使用“用音频文件测试”。
- 连续录音未识别到讲话时会继续监听；首次模型加载可能较慢，整句识别最多等待约 100 秒。

### 旧版本升级指引

从旧版本升级时，先停止并移除旧语音容器，再启动新服务（注意不要删除数据卷）：

```sh
docker stop voxel-whisper
docker rm voxel-whisper
docker compose up -d --build
```

新服务保留网络别名 `whisper`，继续使用 `voxel_whisper_cache` 卷。统一地址由 `SPEECH_API_URL` 配置；ASR 可用 `WHISPER_API_URL` 覆盖，Piper 可用 `PIPER_API_URL` 覆盖。Piper 未设置统一地址时兼容旧 `WHISPER_API_URL`。`SPEECH_PORT` 优先于旧 `WHISPER_PORT`，默认 `8000`。

### 常用管理命令

```sh
# 查看运行日志（含迁移与启动状态）
pnpm docker:logs
# 或：docker compose logs -f

# 停止并移除容器
pnpm docker:down
# 或：docker compose down

# 停止并清理所有数据卷（清空世界、服务配置和语音模型缓存）
docker compose down -v
```

### 环境变量配置

可参考 `.env.docker.example` 创建或在环境中设置：

| 环境变量 | 默认值 | 说明 |
|---------|-------|------|
| `WEB_PORT` | `80` | 前端访问端口 |
| `DEEPSEEK_API_KEY` | - | DeepSeek Agent API 密钥 |
| `WEB_ORIGIN` | `*` | 跨域 Origin 允许列表 |
| `SPEECH_API_URL` | `http://speech:8000/v1` | 统一语音服务地址 |
| `DATABASE_URL` | 容器内连接串 | PostgreSQL 连接地址 |

## 操作说明

- **移动与视角**：点击画面锁定鼠标；`WASD` 移动、`Space` 跳跃、鼠标转向，`Esc` 释放鼠标。
- **方块编辑**：中央准星选择 6 格以内的方块；左键移除、右键放置。也可使用底部 `Remove / Place block` 按钮；点击材质卡选择不同材质。
- **服务器校验**：地形碰撞、重力、速度、编辑距离、基岩保护、玩家占用、相邻支撑和版本冲突均由服务器权威校验。
- **聊天与附近语音**：支持群聊、@ 私聊、语音转文字和语音消息；附近语音可独立开启麦克风与收听，按距离和朝向调节音量，并自动分段转写给附近玩家与 Agent。详见 [聊天与附近语音](../protocol/chat)。
- **会话恢复**：页面刷新自动使用当前标签页的昵称和重连令牌；异常断线 20 秒内可保留身份，超时或服务器重启则重新入房。

## 验证与测试

```sh
pnpm check             # 全仓 ESLint、类型、单元及 DOM 回归测试、所有应用构建
pnpm lint              # 检查应用、共享包、脚本、测试和配置文件
pnpm lint:fix          # 自动修复全仓可自动处理的 lint 问题
pnpm test:integration  # 随机端口、临时存档中的世界协议集成测试
pnpm format:check      # 代码格式检查
```

## 在控制台创建 AI 玩家

首次打开控制台先输入管理员令牌（可用 `pnpm agent:ctl auth show` 读取本地令牌文件），再点击 **模型服务** 配置接口，再到 **Agent 玩家 → 创建 Agent** 设置昵称、模型与能力。

默认创建后加入世界待命，也可选择立即执行任务。角色工作区将任务、角色设置和运行记录分开；离开世界保留设置和进度，再次加入待命不会自动重跑旧任务。已有 DeepSeek 环境变量会在首次启动管理服务时导入。

详见 [AI 玩家接入](../agent/players)。

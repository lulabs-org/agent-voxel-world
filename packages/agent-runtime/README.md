# Agent runtime

`@voxel/agent-runtime` 为服务端托管 Agent 和 CLI 提供同一套 Pi 执行能力。应用只从包入口 `src/index.ts` 导入；包内使用具体相对路径，不通过入口反向引用。

## 目录职责

| 目录          | 职责                                              | 不负责                       |
| ------------- | ------------------------------------------------- | ---------------------------- |
| `transport/`  | Colyseus 世界连接、会话管理与异步取消原语         | 模型推理、任务调度           |
| `perception/` | 环境观察提取、世界状态摘要与注意力评分焦点        | 物理执行、调度唤醒           |
| `cognition/`  | 提示词生成、工具定义、会话上下文与状态检查点      | 调度唤醒、写入宿主存储       |
| `models/`     | 模型目录、模型适配、请求边界上的计费和取消        | 工具执行、任务状态转换       |
| `actions/`    | 动作解析、权限校验、单个及批次执行、建造确认      | 任务归属、模型循环           |
| `task/`       | 任务状态与指令、归属和状态转换、预算管理          | 发起模型请求、执行世界写操作 |
| `runtime/`    | 串联感知、认知、模型、任务与检查点；调度与循环    | 服务端管理接口、数据库存储   |

`contracts.ts` 保留公共类型；`errors.ts` 保留运行错误；不为每个目录增加转导出入口。

## 执行路径

1. `AgentCoordinator` 保证一个角色只有一个模型槽，所有事件进入 `CharacterRunner`。
2. 认知会话复用，但每次事件按接收者重新构造上下文；统一工具处理回复、任务控制和世界动作。
3. `TaskService` 校验归属、状态、预算、身份与修订；控制台和明确停止也使用该服务。
4. 长建造和移动返回动作 ID，由执行器推进并投递结果；期间可回答消息。持续跟随使用本地导航，无模型轮询。
5. 每次实际模型请求单独计量，角色默认额度和执行快照分离；排队不创建运行时任务，不计费。

交流范围分别保留最近 8 组完整交互，私聊互相隔离。检查点 v3 和事件收件箱随宿主存档持久化；重启暂停，未知效果不重放。旧档升级前生成 `.before-character-events-v3.bak`。详细规则和验收入口见 [统一运行时](../../docs/agent/runtime.md)。

## 依赖约束

- `runtime` 是编排层，可以组合 `perception`、`cognition`、`models`、`task`、`transport` 和 `actions`。
- `cognition` 依赖业务规则及只读建造辅助函数，通过注入回调执行动作，不反向导入 `runtime`。
- `task` 不依赖 `cognition`、三方 SDK、`models`、`runtime` 或具体连接实现；观察核对复用感知辅助函数。
- `perception` 负责计算世界观察与注意力，不产生副作用。
- `transport` 和 `actions` 是基础能力层，不依赖上述高层业务模块。
- 包内不导入应用代码、不通过 `index.ts` 回绕；服务端和 CLI 不深层导入包实现。

`tests/agent-runtime-boundaries.test.ts` 检查分层和循环依赖，`tests/pi-runner.test.ts` 通过真实 Pi 循环与可控模型响应检查预算、取消、工具顺序、隔离和检查点恢复。`tests/support/decision-*` 是旧业务用例的确定性测试适配器，不是生产模型执行路径。

## 验证

在仓库根目录运行 `pnpm check`，以及 `pnpm test:agents`、`pnpm test:agent:tasks`、`pnpm test:chat`、`pnpm test:agent:voice`、`pnpm test:voice:services`。`pnpm test:agent:deepseek` 验证 Pi 工具与世界连接。模型及语音集成使用 fixtures，不能替代真实服务验证。`tests/task-service.test.ts` 覆盖修订、保存失败和旧存档迁移。

CLI 多客户端回归 `pnpm test:integration` 会连接 `SERVER_URL` 指向的现有世界并编辑固定坐标，且要求 PostgreSQL 持久化。必须先准备独立测试世界，再显式设置地址，例如 `SERVER_URL=ws://127.0.0.1:12567 pnpm test:integration`，不要直接对正在使用的世界运行。

Docker 验证需单独构建服务端，在隔离实例或短暂停机备份后验证真实模型任务、重启恢复及旧存档兼容。不要用 `down -v` 清空现有数据卷。

## 导航

`actions/navigation/local-map.ts` 管理已知空间，`voxel-astar.ts` 搜索可站立节点，`controller.ts` 执行可取消的位置闭环。跳跃/下落边通过共享 `simulate()` 验证；普通平移检查体积与中间路径。搜索每约 2ms 让出事件循环，并限制扩展节点数量。局部无路不表示全局不可达。

`runtime/follow-step.ts` 在宿主唤醒时推进已保存的跟随意图，不发起模型请求。新消息仍通过正常任务归属流程处理；暂停/取消中止动作，失败时停止，不重放历史方向输入。

验证：`pnpm test:navigation` 启动临时端口的独立内存世界，覆盖真实 WebSocket 和服务端物理；`pnpm bench:navigation` 报告本机地图构建及搜索耗时。`tests/navigation.test.ts` 覆盖确定性物理、动态障碍、未知空间、取消以及 Pi 到跟随调度的链路。

真实模型验收：`NAVIGATION_PROVIDERS=/absolute/path/providers.json pnpm test:navigation:live`。显式读取已有服务配置并产生真实模型费用，在隔离的 Colyseus 世界向托管 Agent 私聊“到我这里来”，断言任务创建、绕墙/上台阶、实际到达和持久化完成；每场景至多 8 次请求；另验收持续跟随期间不请求模型、普通问答保留任务及独立计费、修改目标后实际到达。默认使用 `deepseek` 服务，可用 `NAVIGATION_PROVIDER` 选择其他已配置服务。结果写入忽略目录 `artifacts/navigation-live-model.json`，不输出凭据。

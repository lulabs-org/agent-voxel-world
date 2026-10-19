# Agent runtime

`@voxel/agent-runtime` 为服务端托管 Agent 和 CLI 提供同一套 Pi 执行能力。应用只从包入口 `src/index.ts` 导入；包内使用具体相对路径，不通过入口反向引用。

## 目录职责

| 目录       | 职责                                              | 不负责                       |
| ---------- | ------------------------------------------------- | ---------------------------- |
| `client/`  | Colyseus 世界连接、观察和请求                     | 模型推理、任务调度           |
| `models/`  | 模型目录、Pi 模型适配、请求边界上的计费和取消     | 工具执行、任务状态转换       |
| `actions/` | 动作解析、权限校验、单个及批次执行、建造确认      | 任务归属、模型循环           |
| `task/`    | 任务状态与指令、归属和状态转换、预算、观察核对    | 发起模型请求、执行世界写操作 |
| `pi/`      | 提示词、工具适配、会话上下文、Pi 检查点           | 调度唤醒、写入宿主存储       |
| `runtime/` | 串联模型、工具、任务和检查点；消息唤醒与 CLI 循环 | 服务端管理接口、数据库存储   |

`contracts.ts` 保留公共类型；`errors.ts` 保留运行错误；不为每个目录增加转导出入口。

## 执行路径

1. 服务端调度器或 CLI 调用稳定入口 `AgentRunner.run()`；`AgentCoordinator` 保证同一 Agent 串行处理消息和任务。
2. `ConversationRunner` 仅处理当前消息。可用工具为 `reply`、`start_task`、`revise_task`、`pause_task`、`resume_task`、`cancel_task`，不提供世界动作。每条消息最多提交一个成功命令，失败可以解释或澄清。
3. `TaskService` 集中校验归属、任务状态和预算。命令提交时保存任务与宿主执行记录，成功后才交接给 `TaskRunner`。控制台与快捷停止命令也使用该服务。
4. `TaskRunner` 使用独立上下文与工具集：`observe`、`chat`、`goto`、`follow`、`edit`、`build`、`house`，以及 `complete_task`、`report_blocked`、`request_input`、`wait_for`。运行状态由程序管理，不再要求模型提交意图或 running 状态。
5. `runtime/action-executor.ts` 组合动作权限、世界写入、建造恢复和观察核对。每次执行绑定内部任务 ID 与修订号，修改/取消后的迟到结果不能更新任务。`runtime/pi-loop.ts` 只共享 Pi 请求和顺序工具循环机制，不共享对话与任务上下文。
6. 普通消息在动作边界插入，回复后继续原来的运行任务；暂停、受阻或已结束任务不会因问候重启。持续跟随由本地控制器推进，消息处理不改变跟随目标。

对话请求单独有上限（最多 12 次请求、50,000 token、60 秒，并取配置中的更小值），关闭任务预算也不会关闭消息保护。所有请求计入 Agent 总用量；纯聊天不计入任务，成功任务命令的消息处理用量只转入目标任务一次。任务执行继续使用原任务和计划预算。新任务接收与首个动作分属两个模型循环，通常增加一次模型交接。

`AgentRunState` 保存业务进度、稳定任务身份与修订号、跟随意图和版本 2 的 Pi 检查点。普通对话不进入任务的最近 8 轮上下文。目标修改清空旧模型工具历史，保留已发生的动作及未确认效果。

读取旧存档时先生成 `.before-conversation-tasks-v2.bak`；迁移当前状态和历史执行中的运行时快照。版本 1 的模型历史不再执行，执行中动作仍作为未知效果保留，并在观察后核对，聊天和移动不自动重放。重启依旧暂停执行，私聊会话失效需要重新指派；没有数据库迁移。

## 依赖约束

- `runtime` 是编排层，可以组合 `models`、`pi`、`task` 和 `actions`。
- `pi` 依赖业务规则及只读建造辅助函数，通过注入回调执行动作，不反向导入 `runtime`。
- `task` 不依赖 `pi`、Pi SDK、`models`、`runtime` 或具体连接实现；观察核对可以复用建造辅助函数。存档中的模型消息作为不透明数据保存，仅由 Pi 适配层解析，序列化格式保持兼容。
- `models` 只使用公共接口，预算通过 `RequestAccounting` 注入。
- `actions` 和 `client` 不依赖上述高层模块。
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

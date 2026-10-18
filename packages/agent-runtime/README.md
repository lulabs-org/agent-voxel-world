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

1. 服务端调度器或 CLI `scheduled-loop.ts` 调用 `AgentRunner.run()`。
2. `task/observation.ts` 获取观察、检查等待条件、核对未确认动作，并隔离公开与私聊任务信息。
3. `models/pi-provider.ts` 在每个真实模型请求前后检查及记录预算；Pi 驱动多轮推理和顺序工具调用。
4. `pi/tools.ts` 将工具参数交给注入的执行函数；任务控制约束由 `task/transitions.ts` 校验。
5. `runtime/execute-step.ts` 串联任务归属检查、预算绑定、`actions/` 执行、结果检查点及任务状态更新。
6. `pi/checkpoint.ts` 更新上下文存档；`AgentRunner` 调用宿主提供的持久化回调。保存失败后停止后续写操作。

`PiTurnState` 是单次运行的可变上下文，只由本次循环和顺序工具共享，不跨 Agent 或跨任务共享。`AgentRunState` 是宿主持有的可恢复状态；可选 `follow` 字段保存目标会话、距离、任务身份和迟滞状态；旧存档缺省为空。Pi 检查点版本不变。

## 依赖约束

- `runtime` 是编排层，可以组合 `models`、`pi`、`task` 和 `actions`。
- `pi` 依赖业务规则及只读建造辅助函数，通过注入回调执行动作，不反向导入 `runtime`。
- `task` 不依赖 `pi`、`models`、`runtime` 或具体连接实现；观察核对可以复用建造辅助函数。存档中的 Pi 消息仍保留原 SDK 类型，以维持现有序列化契约。
- `models` 只使用公共接口，预算通过 `RequestAccounting` 注入。
- `actions` 和 `client` 不依赖上述高层模块。
- 包内不导入应用代码、不通过 `index.ts` 回绕；服务端和 CLI 不深层导入包实现。

`tests/agent-runtime-boundaries.test.ts` 检查分层和循环依赖，`tests/pi-runner.test.ts` 通过真实 Pi 循环与可控模型响应检查预算、取消、工具顺序、隔离和检查点恢复。`tests/support/decision-*` 是旧业务用例的确定性测试适配器，不是生产模型执行路径。

## 验证

在仓库根目录运行 `pnpm check`，以及 `pnpm test:agents`、`pnpm test:agent:tasks`、`pnpm test:chat`、`pnpm test:agent:voice`、`pnpm test:voice:services`。`pnpm test:agent:deepseek` 验证 Pi 工具与世界连接。模型及语音集成使用 fixtures，不能替代真实服务验证。

CLI 多客户端回归 `pnpm test:integration` 会连接 `SERVER_URL` 指向的现有世界并编辑固定坐标，且要求 PostgreSQL 持久化。必须先准备独立测试世界，再显式设置地址，例如 `SERVER_URL=ws://127.0.0.1:12567 pnpm test:integration`，不要直接对正在使用的世界运行。

Docker 验证需单独构建服务端，在隔离实例或短暂停机备份后验证真实模型任务、重启恢复及旧存档兼容。不要用 `down -v` 清空现有数据卷。

## 导航

`actions/navigation/local-map.ts` 管理已知空间，`voxel-astar.ts` 搜索可站立节点，`controller.ts` 执行可取消的位置闭环。跳跃/下落边通过共享 `simulate()` 验证；普通平移检查体积与中间路径。搜索每约 2ms 让出事件循环，并限制扩展节点数量。局部无路不表示全局不可达。

`runtime/follow-step.ts` 在宿主唤醒时推进已保存的跟随意图，不发起模型请求。新消息仍通过正常任务归属流程处理；暂停/取消中止动作，失败时停止，不重放历史方向输入。

验证：`pnpm test:navigation` 启动临时端口的独立内存世界，覆盖真实 WebSocket 和服务端物理；`pnpm bench:navigation` 报告本机地图构建及搜索耗时。`tests/navigation.test.ts` 覆盖确定性物理、动态障碍、未知空间、取消以及 Pi 到跟随调度的链路。

真实模型验收：`NAVIGATION_PROVIDERS=/absolute/path/providers.json pnpm test:navigation:live`。显式读取已有服务配置并产生真实模型费用，在隔离的 Colyseus 世界向托管 Agent 私聊“到我这里来”，断言任务创建、绕墙/上台阶、实际到达和持久化完成；每场景至多 8 次请求。默认使用 `deepseek` 服务，可用 `NAVIGATION_PROVIDER` 选择其他已配置服务。结果写入忽略目录 `artifacts/navigation-live-model.json`，不输出凭据。

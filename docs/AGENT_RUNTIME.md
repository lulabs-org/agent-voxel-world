# Agent Runtime 架构与执行流程设计文档

托管角色的入口与调度由 [Agent Gateway](AGENT_GATEWAY.md) 负责；本包继续负责对话、任务、动作和结果验证，独立 CLI 仍可直接使用。

`@voxel/agent-runtime` 为服务端托管 Agent 与命令行 CLI 提供统一的 Pi 智能体执行内核。其核心设计遵循**双循环隔离**、**乐观并发与租约控制（Lease）**、**零成本物理跟随**以及**严格分级预算与持久化熔断**机制。

---

## 1. 架构总览与分层设计

包内遵循严格的单向依赖规则，禁止循环依赖与反向引用：

```mermaid
graph TD
    classDef runtime fill:#2563eb,stroke:#1d4ed8,stroke-width:2px,color:#fff;
    classDef pi fill:#7c3aed,stroke:#6d28d9,stroke-width:2px,color:#fff;
    classDef task fill:#059669,stroke:#047857,stroke-width:2px,color:#fff;
    classDef act fill:#d97706,stroke:#b45309,stroke-width:2px,color:#fff;
    classDef client fill:#475569,stroke:#334155,stroke-width:2px,color:#fff;
    classDef model fill:#db2777,stroke:#be185d,stroke-width:2px,color:#fff;

    subgraph RuntimeLayer["Runtime 编排层 (packages/agent-runtime/src/runtime)"]
        AR["AgentRunner / AgentCoordinator"]:::runtime
        CR["ConversationRunner<br/>(消息会话与指令解释)"]:::runtime
        TR["TaskRunner<br/>(任务模型循环与动作决策)"]:::runtime
        FS["follow-step<br/>(本地物理跟随闭环)"]:::runtime
        AE["action-executor<br/>(世界动作防迟到守卫)"]:::runtime
        PL["pi-loop<br/>(通用底层工具循环)"]:::runtime
    end

    subgraph PiLayer["Pi 交互适配层 (packages/agent-runtime/src/pi)"]
        PP["Prompts 提示词体系"]:::pi
        CT["Conversation Tools<br/>(reply / start / revise 等)"]:::pi
        TT["Task Tools<br/>(goto / edit / build / complete 等)"]:::pi
        CP["Checkpoint 快照管理"]:::pi
    end

    subgraph TaskLayer["Task 业务域层 (packages/agent-runtime/src/task)"]
        TS["TaskService<br/>(租约管理 / 状态机 / 归属校验)"]:::task
        RB["RequestBudget<br/>(调用次数 / Token / 超时预算)"]:::task
        TO["Observation & Signature<br/>(世界签名与核对)"]:::task
    end

    subgraph ActionLayer["Actions 动作执行层 (packages/agent-runtime/src/actions)"]
        NA["Navigation<br/>(LocalMap / A* / 运动控制)"]:::act
        BA["Building<br/>(建造计划 / 批量放置 / 恢复)"]:::act
        EX["Action Parser & Execute"]:::act
    end

    subgraph ModelLayer["Models 模型层 (packages/agent-runtime/src/models)"]
        MC["Model Catalog & Pi Adapter"]:::model
        RA["RequestAccounting<br/>(用量统计与流式熔断)"]:::model
    end

    subgraph ClientLayer["Client 连接层 (packages/agent-runtime/src/client)"]
        SS["Colyseus AgentSession<br/>(观察订阅 / 物理移动 / 动作 RPC)"]:::client
    end

    AR --> CR
    AR --> TR
    AR --> FS

    CR --> CT
    CR --> TS
    CR --> PL

    TR --> TT
    TR --> TS
    TR --> AE
    TR --> PL

    PL --> MC
    PL --> RA
    AE --> BA
    AE --> NA
    AE --> SS
    FS --> NA
    FS --> SS
```

### 分层职责矩阵

| 模块目录                                                                       | 核心职责                                            | 明确不负责事项                   |
| :----------------------------------------------------------------------------- | :-------------------------------------------------- | :------------------------------- |
| [`packages/agent-runtime/src/runtime/`](../packages/agent-runtime/src/runtime) | 串联协调调度、并发互斥、消息唤醒、分发执行          | 服务端 HTTP 接口、数据库直接操作 |
| [`packages/agent-runtime/src/task/`](../packages/agent-runtime/src/task)       | 任务状态机、Lease 租约、权限归属校验、预算统计      | 模型请求发起、世界直接写入       |
| [`packages/agent-runtime/src/pi/`](../packages/agent-runtime/src/pi)           | 提示词构造、Tool 映射规范、会话上下文管理、检查点   | 调度时钟、物理位移控制           |
| [`packages/agent-runtime/src/actions/`](../packages/agent-runtime/src/actions) | 物理移动、方块批量放置/破坏、A\* 寻路计算与闭环跟随 | 任务状态转换、模型调用           |
| [`packages/agent-runtime/src/models/`](../packages/agent-runtime/src/models)   | 模型接口适配、流式生成处理、请求级计费与取消        | 业务逻辑、工具执行               |
| [`packages/agent-runtime/src/client/`](../packages/agent-runtime/src/client)   | Colyseus 网络连接、状态观察订阅、世界写请求         | 任务逻辑、决策生成               |

---

## 2. 调度执行全景主流程

外部驱动（服务端心跳调度器或 CLI）调用 `AgentRunner.run()`。`AgentCoordinator` 负责保证单 Agent 的串行原子执行：

```mermaid
flowchart TD
    Start(["宿主唤醒: AgentRunner.run()"]):::startNode
    Lock{"WeakSet 互斥检查:<br/>Agent 实例是否正在执行?"}
    Aborted{"AbortSignal 检查:<br/>当前运行是否已取消?"}
    CheckAttention{"是否有待处理的排队消息?<br/>(attention.take())"}

    subgraph ConversationFlow["阶段 A: 会话响应 (ConversationRunner)"]
        CR["进入 ConversationRunner"]
        CRTools["仅挂载会话工具:<br/>reply, start_task, revise_task,<br/>pause_task, resume_task, cancel_task"]
        CommitCmd["提交 TaskService.commit() / 发送聊天回复"]
        SaveMsgCP["持久化消息检查点 (Checkpoint)"]
    end

    CheckTask{"当前任务是否存在<br/>且处于 running / waiting?"}
    CheckFollow{"是否处于持续跟随意图?<br/>(memory.follow != null)"}

    subgraph FollowFlow["阶段 B1: 本地物理跟随 (follow-step)"]
        CheckFollowCap{"检查任务预算余量"}
        RunFollow["执行 runFollowStep()<br/>(本地 A* 路径追踪与移动闭环，零 LLM 消耗)"]
    end

    subgraph TaskFlow["阶段 B2: 任务推理与执行 (TaskRunner)"]
        TR["进入 TaskRunner"]
        GetLease["申请任务租约 TaskLease<br/>(包含 UUID + revision 递增版号)"]
        TRTools["挂载任务动作工具:<br/>observe, chat, goto, edit, build,<br/>complete_task, report_blocked, wait_for 等"]
        ExecAction["通过 action-executor 执行动作<br/>(带 assertCurrent 租约版本强校验)"]
        SaveTaskCP["保存任务状态与 Pi 上下文检查点"]
    end

    End(["释放 WeakSet 锁，结束本次唤醒"]):::endNode

    Start --> Lock
    Lock -- 已在执行 --> ThrowErr["抛出 AgentRuntimeError(并发拒绝)"]
    Lock -- 空闲 --> AddLock["锁定 WeakSet(memory)"]
    AddLock --> Aborted
    Aborted -- 已中止 --> End
    Aborted -- 活跃 --> CheckAttention

    CheckAttention -- 有玩家消息 --> CR
    CR --> CRTools --> CommitCmd --> SaveMsgCP --> CheckTask
    CheckAttention -- 无消息 --> CheckTask

    CheckTask -- 无活跃任务 --> End
    CheckTask -- 有任务 --> CheckFollow

    CheckFollow -- 是 --> CheckFollowCap
    CheckFollowCap -- 预算超限 --> SetBudgetStatus["标记 task.status='budget'"] --> End
    CheckFollowCap -- 预算充足 --> RunFollow --> End

    CheckFollow -- 否 --> TR
    TR --> GetLease --> TRTools --> ExecAction --> SaveTaskCP --> End

    classDef startNode fill:#16a34a,stroke:#15803d,stroke-width:2px,color:#fff;
    classDef endNode fill:#475569,stroke:#334155,stroke-width:2px,color:#fff;
```

---

## 3. 核心机制详细序列

### 3.1 消息处理与任务状态机流（ConversationRunner）

- **职责边界**：仅理解玩家发来的聊天，负责礼貌回复或转换为任务指令；**禁止直接发起世界动作（如移动、放置方块）**。
- **独立预算安全罩**：最多 12 次请求、50,000 Token、60 秒超时，纯聊天用量不计入建筑任务。

```mermaid
sequenceDiagram
    autonumber
    actor Player as 玩家 / 观察事件
    participant CR as ConversationRunner
    participant PL as PiLoop (LLM 循环)
    participant TS as TaskService
    participant Memory as AgentRunState (持久化状态)

    Player->>CR: 收到关注消息 (WorldEvent)
    CR->>CR: 初始化独立安全预算 (Max 12 turns, 60s)
    CR->>PL: 注入 conversationTools & conversationPrompt
    alt 模型决策: 纯文本回复 (reply)
        PL-->>CR: 调用 reply(text)
        CR->>CR: paceChat() 防刷屏节流控制
        CR->>Player: 发送聊天响应 (公聊/私聊)
        CR->>Memory: 标记 conversation.state = 'done'
    else 模型决策: 任务指令 (start_task / revise_task / pause...)
        PL-->>CR: 调用 start_task(goal) 或 revise_task(goal)
        CR->>TS: TaskService.commit(command, authority)
        TS->>TS: 校验权限归属 (player/operator) 与状态合法性
        TS->>Memory: 更新 task.goal，重置模型上下文，递增 revision 版号
        CR->>Player: 发送接单/修订确认消息
    end
    CR->>Memory: 触发 checkpoint() 保存当前状态
```

---

### 3.2 任务决策与动作执行流（TaskRunner & ActionExecutor）

- **乐观并发与 Lease 机制**：每个任务执行段持有 `TaskLease { id, revision, startedAt }`。
- **防迟到机制**：若在长耗时的动作执行或模型调用期间，玩家插话并修改（`revise_task`）或取消了任务，旧任务的迟到结果在提交世界前会被 `service.assertCurrent(lease)` 拦截并丢弃。

```mermaid
sequenceDiagram
    autonumber
    participant TR as TaskRunner
    participant TS as TaskService
    participant PL as PiLoop
    participant AE as action-executor
    participant Session as Colyseus Session

    TR->>TS: 申请当前执行租约 lease()
    TR->>Session: prepareDecision() 收集周围方块/玩家状态
    TR->>PL: runPiLoop (任务工具集 + 最近 8 轮上下文)
    loop 顺序工具调用循环
        PL->>AE: 调用工具执行世界写动作 (如 edit / build / goto)
        AE->>TS: assertCurrent(lease) 校验租约版本号
        alt 租约依然有效
            AE->>Session: 发起实际动作写操作 (方块变更 / 位移)
            Session-->>AE: 返回网络执行结果 ActionResult
            AE->>Session: 重新拉取 Observation 并核对方块世界签名
            AE-->>PL: 返回执行结果反馈 (BatchResult)
        else 租约已失效 (中途被玩家指令修改或取消)
            AE-->>TR: 抛出 AgentRuntimeError("任务已修改，忽略过期执行结果")
            TR->>TR: 立即终止后续动作写入
        end
    end
    TR->>TR: 更新 Pi 检查点 (滑动保留最近 8 轮历史)
    TR->>TS: 确认并 flush 任务预算与计时
```

---

### 3.3 零成本本地物理跟随（follow-step）

当 Agent 处于跟随玩家状态时，不消耗 LLM Token，直接在宿主循环中通过本地导航推进：

```mermaid
flowchart TD
    In(["进入 follow-step 唤醒"]):::startNode
    CheckTarget{"目标玩家是否在线且在视距内?"}
    CalcDist{"计算与玩家的欧式距离"}

    Near["距离 <= 停止阈值:<br/>原地保持，停止平移输入"]
    Far["距离在有效跟踪区间:<br/>启动本地 A* 路径检索 (voxel-astar)"]
    Lost["目标离开视野或丢失:<br/>停止移动，清理 follow 状态"]

    StepRun["控制器执行微步物理仿真 (controller.ts)"]
    ColyseusSend["向服务端发送位移增量 session.move(dx, dz, jump)"]
    Done(["完成本帧物理推进"]):::endNode

    In --> CheckTarget
    CheckTarget -- 否 --> Lost --> Done
    CheckTarget -- 是 --> CalcDist

    CalcDist -- 足够接近 --> Near --> Done
    CalcDist -- 距离过远/脱离 --> Lost
    CalcDist -- 需要接近 --> Far --> StepRun --> ColyseusSend --> Done

    classDef startNode fill:#16a34a,stroke:#15803d,stroke-width:2px,color:#fff;
    classDef endNode fill:#475569,stroke:#334155,stroke-width:2px,color:#fff;
```

---

## 4. 关键设计模式总结

1. **双循环上下文隔离（Dual Loop Context Isolation）**
   - 聊天会话循环与建造任务循环拥有独立的提示词、工具集和记忆队列；
   - 玩家的问候、闲聊绝不进入任务的最近 8 轮工具执行上下文，避免消耗任务 Token 和稀释模型注意力。
2. **基于 Revision 的租约保护（Lease Protection）**
   - 任何改写任务（`revise` / `cancel`）都会重置 `revision`；
   - 正在执行的异步网络请求与批量方块放置，在写操作前必须验证租约，防止“旧任务动作破坏新任务场景”。
3. **分级预算与持久化熔断（Budget & Persistence Circuit Breaker）**
   - 每一轮会话和任务都有严格的调用次数、Token 上限和耗时限制；
   - 若持久化操作（`checkpoint()`）发生异常，执行器立即熔断写操作，避免状态与世界不同步。

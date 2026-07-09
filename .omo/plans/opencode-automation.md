# opencode-automation - Work Plan

## TL;DR (For humans)

**What you'll get:** 一个基于 OpenCode API 的自动化任务系统（"牛马系统"）。它能帮你启动 OpenCode 服务、通过 API 调用 AI Agent 自动执行任务、定时调度工作、自我监控健康状况。类似 OpenClaw 但更轻量，核心能力通过 OpenCode 的 AI Agent 驱动。

**Why this approach:** 不重复造轮子——OpenCode 已经提供了 AI Agent、会话管理、文件操作、终端执行等完整能力，我们只需要在其上构建自动化调度层。

**What it will NOT do:** 不修改 OpenCode 源码，不做多租户，不部署上云（初期本地运行），不替代 OpenCode 自有的 TUI/CLI。

**Effort:** Large（分 4 个 Phase 迭代，Phase 1 为 Medium）
**Risk:** Medium - 依赖 OpenCode API 的稳定性和本地服务的可用性
**Decisions I made for you:** TypeScript + Bun 技术栈（与 OpenCode 一致）；本地 HTTP 通信；JSON 文件做任务存储；先 Phase 1 跑通再扩展

Your next move: 审阅计划并批准，我即开始执行 Phase 1

---

> TL;DR (machine): Large effort / Medium risk — 基于 OpenCode HTTP API 构建自动化任务编排系统，四阶段迭代

## Scope
### Must have
- OpenCode Server 生命周期管理（启动/停止/状态监控）
- OpenCode API v2 客户端封装（自动重连、错误处理）
- 任务定义与执行管道（Task → Session → Agent → Result）
- 定时任务调度（Cron）
- 健康检查与自愈（Server 挂了自动重启）
- 完整的自动化测试

### Must NOT have (guardrails, anti-slop, scope boundaries)
- 不修改 OpenCode 源码
- 不做多租户/用户系统
- 不引入外部消息队列（Kafka/RabbitMQ 等）
- 不部署到云服务（初期仅本地运行）
- 不实现 OpenCode 已有的 UI/TUI 功能
- 不引入重量级数据库（初期使用 JSON/SQLite）

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD + tests-after 混合 — 关键模块先写测试再实现，集成测试在实现后补充
- Framework: Bun built-in test runner (`bun test`)
- Evidence: .omo/evidence/task-<N>-opencode-automation.<ext>

## Execution strategy
### Parallel execution waves
> Phase 1: 5 todos, 顺序执行（有依赖链）
> Phase 2+: 后续根据 Phase 1 完成情况规划

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1. 项目骨架 | - | 2,3,4,5 | - |
| 2. Server 管理器 | 1 | 3,4 | - |
| 3. API 客户端封装 | 1,2 | 4 | - |
| 4. 任务引擎 | 1,2,3 | 5 | - |
| 5. 监控与自愈 | 1,2,4 | - | 3（部分） |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->

### Wave 1: 项目基础设施 (Phase 1)

- [ ] 1. 初始化项目骨架
  What to do / Must NOT do:
  - 创建 Bun + TypeScript 项目 (`bun init`)
  - 配置 tsconfig.json（strict 模式）
  - 安装依赖：`@opencode-ai/sdk`、`effect`（如果 SDK 需要）、`zod`（配置校验）
  - 创建目录结构：
    ```
    src/
      server/       # OpenCode Server 管理
      client/       # API 客户端封装
      engine/       # 任务引擎
      monitor/      # 监控模块
      types/        # 类型定义
      config/       # 配置
    test/
    ```
  - 配置 prettier、.gitignore 更新
  - 配置 bunfig.toml
  - 必须实现 `src/index.ts` 作为入口，导出所有模块
  - 不得复制 OpenCode 源码，只能通过 npm 依赖引用 SDK
  Parallelization: Wave 1 | Blocked by: - | Blocks: 2,3,4,5
  References: opencode package.json 的结构可参考；当前项目已有 .gitignore
  Acceptance criteria: `bun run src/index.ts` 不报错；`bun test` 能运行空测试
  QA scenarios: happy — 运行 `bun run typecheck` 通过；failure — 故意引入类型错误应被 tsc 捕获
  Commit: Y | feat: scaffold project structure with Bun + TypeScript

- [ ] 2. 实现 OpenCode Server 生命周期管理器
  What to do / Must NOT do:
  - 实现 `ServerManager` 类，功能包括：
    - `start()`: 通过 `opencode serve` 启动子进程，监听 stdout 等待 "opencode server listening" 信号
    - `stop()`: 优雅关闭子进程（SIGTERM → SIGKILL）
    - `restart()`: 停止后启动
    - `healthCheck()`: 调用 `/health` 端点确认服务可用
    - `getUrl()`: 返回服务器地址
    - `isRunning()`: 返回运行状态
  - 支持配置：hostname、port、logLevel、超时时间
  - 支持 AbortSignal 取消
  - Server 异常退出时触发事件
  - 不得硬编码路径 — 通过环境变量或配置指定 opencode 二进制路径
  - 必须处理 Windows 兼容性（子进程处理）
  - 参考 `packages/sdk/js/src/server.ts` 的实现模式但不直接复制
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 3,4
  References:
    - opencode SDK server.ts: packages/sdk/js/src/server.ts
    - opencode serve 命令: packages/opencode/src/cli/cmd/serve.ts
    - process.ts 辅助: packages/sdk/js/src/process.ts
  Acceptance criteria:
    - `bun test` 通过 server manager 的单元测试
    - 能启动 opencode serve 并检测到 listening 信号
  QA scenarios:
    - happy: start → healthCheck 返回 200 → stop → isRunning 返回 false
    - failure: 指定无效端口 → 启动失败 → 抛出明确错误
    - edge: 重复 start 不应启动多个进程
  Evidence: .omo/evidence/task-2-opencode-automation.md
  Commit: Y | feat: implement OpenCode server lifecycle manager

- [ ] 3. 封装 OpenCode API v2 客户端
  What to do / Must NOT do:
  - 基于 `@opencode-ai/sdk` 的 `createOpencodeClient` 封装 `OpenCodeClient` 类
  - 自动从 ServerManager 获取 baseUrl
  - 提供以下核心方法封装：
    - `session` 操作：list、create、get、prompt、messages、delete
    - `agent` 操作：list、get
    - `model` 操作：list
    - `health` 检查
  - 错误处理：连接失败自动重试（3 次）、超时处理
  - 支持流式响应（SSE）的消息读取
  - 所有方法返回 typed Promise
  - 不得绕过 SDK 直接调用 HTTP（除非 SDK 未覆盖的端点）
  - 必须要有完整的 TypeScript 类型导出
  Parallelization: Wave 1 | Blocked by: 1,2 | Blocks: 4
  References:
    - SDK v2 client: packages/sdk/js/src/v2/client.ts
    - SDK v2 gen types: packages/sdk/js/src/v2/gen/types.gen.ts
    - OpenAPI spec: doc/openapi.json（本地已保存）
  Acceptance criteria:
    - 单元测试 mock HTTP 响应，验证每个方法调用正确的 API 路径
    - 集成测试：启动真实 OpenCode Server，调用 health/list 端点
  QA scenarios:
    - happy: createClient → health() → true
    - failure: Server 未启动 → 抛出连接拒绝错误 → 自动重试
  Evidence: .omo/evidence/task-3-opencode-automation.md
  Commit: Y | feat: wrap OpenCode API v2 client with auto-reconnect

- [ ] 4. 实现任务引擎（Task Engine）
  What to do / Must NOT do:
  - 定义核心类型：`Task`、`TaskStep`、`TaskResult`、`TaskStatus`
  - Task 结构：
    ```typescript
    interface Task {
      id: string
      name: string
      description?: string
      steps: TaskStep[]
      schedule?: CronExpression  // 可选定时
      maxRetries: number
      timeout: number
      createdAt: Date
    }
    ```
  - TaskStep 支持的类型：
    - `prompt`: 向 Agent 发送提示词，获取回复
    - `session_command`: 在会话中执行命令
    - `file_operation`: 文件读写操作
    - `shell_command`: 通过 PTY 执行 shell
    - `webhook`: 触发 Webhook
  - 实现 `TaskExecutor`：
    - 按顺序执行 steps
    - 错误重试（可配置次数）
    - 超时控制
    - 结果收集
  - 实现 `TaskScheduler`：
    - 基于 `node-cron` 或 Bun 原生定时器
    - 支持 cron 表达式
    - 任务持久化（JSON 文件存储）
  - 实现 `TaskStore`：
    - 增删改查任务
    - 持久化到本地 JSON 文件
    - 启动时恢复未完成的任务
  - 不得使用外部数据库（Phase 1 用 JSON 文件）
  - 不得自己实现 cron 解析 — 使用成熟库
  Parallelization: Wave 1 | Blocked by: 1,2,3 | Blocks: 5
  References:
    - OpenCode session API: 参考 packages/protocol/src/groups/session.ts
    - Effect 框架的调度模式（可选参考）
  Acceptance criteria:
    - 单元测试覆盖 TaskExecutor 的 step 执行、重试、超时
    - 集成测试：创建一个 prompt 任务 → 通过真实 OpenCode 执行
  QA scenarios:
    - happy: 定义简单 prompt 任务 → scheduler 触发 → executor 执行 → 获取结果
    - failure: 任务超时 → executor 抛出 TimeoutError → 触发重试（最多 N 次）
    - persistence: 定义任务 → 重启程序 → 任务仍在列表中
  Evidence: .omo/evidence/task-4-opencode-automation.md
  Commit: Y | feat: implement task engine with executor, scheduler, and store

- [ ] 5. 实现健康监控与自愈模块
  What to do / Must NOT do:
  - 实现 `HealthMonitor`：
    - 定期（默认 30s）检查 OpenCode Server 健康状态
    - 检查指标：HTTP 可达性、响应时间、内存/CPU 使用
    - 记录健康历史（内存 + JSON 持久化）
  - 实现 `AutoHealer`：
    - Server 不可用时自动重启（最多 3 次）
    - 重启间隔递增（10s → 30s → 60s）
    - 超过最大重启次数后触发告警
  - 实现 `Logger`：
    - 结构化日志（JSON 格式）
    - 日志轮转（按大小/日期）
    - 错误日志单独存储
  - 实现简单的状态 Web 界面（可选，用 Hono 起一个小 HTTP 服务）：
    - `GET /` 显示系统概览
    - `GET /health` 健康状态
    - `GET /tasks` 任务列表
  - 告警机制：超过阈值时输出到 stderr / 写入告警日志
  - 不得使用外部监控系统（Prometheus/Grafana 等）
  - 不得发送外部通知（Phase 1 仅本地日志）
  Parallelization: Wave 1 | Blocked by: 1,2,4 | Blocks: -
  References:
    - OpenCode health endpoint: packages/protocol/src/groups/health.ts
  Acceptance criteria:
    - monitor 能检测 server 进程崩溃并触发 autohealer 重启
    - 测试日志轮转功能
  QA scenarios:
    - happy: server 运行 → health check 通过 → 日志记录正常
    - failure: kill server 进程 → monitor 检测到不可用 → autohealer 重启 → 恢复正常
    - edge: 连续重启 3 次失败 → 停止尝试 → 输出告警
  Evidence: .omo/evidence/task-5-opencode-automation.md
  Commit: Y | feat: implement health monitoring and auto-healing

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit — 检查所有 todo 是否完成
- [ ] F2. Code quality review — TypeScript strict 模式无错误
- [ ] F3. Real manual QA — 启动完整系统，执行一个示例自动化任务
- [ ] F4. Scope fidelity — 确认没有超范围（没改 opencode 源码等）

## Commit strategy
- Conventional Commits (feat/fix/chore/docs/test)
- 每个 todo 一个独立 commit，方便回滚
- Phase 1 完成后合并为可运行的基线版本

## Success criteria
- [ ] 能启动 OpenCode Server 并通过 API 通信
- [ ] 能定义并执行自动化任务（prompt agent → 获取结果）
- [ ] Server 崩溃后能自动恢复
- [ ] 所有测试通过
- [ ] 项目结构清晰，TypeScript strict 模式无报错

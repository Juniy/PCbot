---
slug: opencode-automation
status: drafting
intent: unclear
pending-action: write .omo/plans/opencode-automation.md
approach: 基于 OpenCode HTTP API 构建自动化任务编排系统，分阶段迭代
---

# Draft: opencode-automation

## Research Summary

**OpenClaw** (github.com/openclaw/openclaw, 382K stars) 是一个自托管的 AI 助手网关：
- 连接 WhatsApp/Telegram/Discord/Slack/微信等多渠道到 AI Agent
- 技能系统（Skills）、定时任务（Cron）、Webhook 自动化
- MIT 开源，TypeScript 全栈

**OpenCode** (github.com/anomalyco/opencode, v1.17.16) 是开源 AI Coding Agent：
- 完整的 HTTP API（v1 + v2，36925 行 OpenAPI 规范）
- 18 个 API Group：Session、Model、Agent、FileSystem、PTY、Command、Skill 等
- 16+ AI 提供商集成
- SDK: `@opencode-ai/sdk` (TypeScript 客户端)
- 通过 `opencode serve` 启动 HTTP 服务（默认 127.0.0.1:4096）

## 系统设计

### 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                 PCbot 自动化牛马系统                          │
│                                                             │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ 调度引擎  │  │ 任务执行器    │  │ 监控/自愈模块        │  │
│  │ (Cron/   │→│ (Session +   │→│ (健康检查/错误恢复/   │  │
│  │ 事件驱动) │  │  Agent 编排) │  │  性能追踪)           │  │
│  └──────────┘  └──────┬───────┘  └──────────────────────┘  │
│                        │                                     │
│  ┌─────────────────────▼──────────────────────────────────┐  │
│  │            OpenCode API Client Layer                    │  │
│  │    (@opencode-ai/sdk + 自定义封装)                       │  │
│  └─────────────────────▲──────────────────────────────────┘  │
│                        │ HTTP API (127.0.0.1:4096)           │
│  ┌─────────────────────┴──────────────────────────────────┐  │
│  │              OpenCode Server (opencode serve)           │  │
│  │    会话管理 | Agent 编排 | 模型调用 | 文件操作 | PTY     │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 分阶段实施路线

**Phase 1 - 基础设施**（当前）
- OpenCode Server 生命周期管理（启动/停止/健康检查）
- API 客户端封装（基于 SDK v2）
- 基础配置系统
- 项目骨架

**Phase 2 - 自动化引擎**
- 任务定义和执行管道
- 定时任务（Cron）
- 会话批量管理
- Agent 自动切换和编排

**Phase 3 - 智能增强**
- AI 驱动的任务分解与执行
- 结果验证与重试
- 日志分析与自诊断
- 性能指标收集

**Phase 4 - 进化系统**
- 自优化（根据执行历史调整策略）
- 扩展机制（插件/自定义技能）
- Webhook/事件集成
- 多渠道通知

## Components (topology ledger)
| id | outcome | status | evidence |
|---|---|---|---|
| opencode-server-mgmt | 能启动/停止/监控 OpenCode 服务 | active | - |
| api-client | 封装完整的 OpenCode API 调用 | active | - |
| task-engine | 任务定义/调度/执行/重试 | active | - |
| monitoring | 健康检查/自愈/日志 | active | - |
| self-evolution | 基于历史数据自动优化 | deferred | Phase 4 |

## Open assumptions (announced defaults)
| assumption | adopted default | rationale | reversible? |
|---|---|---|---|
| 开发语言 | TypeScript (Bun) | OpenCode 本身就是 Bun/TS 技术栈，SDK 也是 TS | 否 |
| 包管理 | Bun workspace | 与 OpenCode 一致 | 是 |
| 通信方式 | HTTP API (localhost:4096) | OpenCode serve 默认端口 | 是 |
| 任务存储 | 本地 JSON/SQLite | 初期简化，不引入外部依赖 | 是 |
| 运行平台 | Windows (当前环境) | 用户工作在 Windows 上 | 是 |

## Findings
- OpenCode 通过 `opencode serve` 启动 HTTP 服务，CLI 入口在 packages/opencode/src/cli/cmd/serve.ts
- SDK v2 客户端自动从 OpenAPI spec 生成，路径在 packages/sdk/js/src/v2/gen/
- Session 生命周期：create → prompt/message → (fork/revert) → delete
- Agent 系统支持多角色：build/debug/plan 等
- 关键 API endpoint: session.prompt (发送提示词)、session.list (列出会话)、session.message (流式响应)

## Decisions (with rationale)
1. **直接使用 SDK 而非手写 HTTP 请求** - 已有完整自动生成的 TypeScript 客户端，减少工作量
2. **从 Phase 1 开始迭代而非一次性做完** - 需求模糊，先跑通核心链路再扩展
3. **本地 Server 模式** - 用户在自己的机器上运行，OpenCode serve 绑定 localhost

## Scope IN
- OpenCode Server 进程管理
- 基础 API 客户端
- 任务调度和执行
- 健康监控
- 自动化测试

## Scope OUT (Must NOT have)
- 不重新实现 OpenCode 内部功能（直接复用其 API）
- 不引入外部消息队列/K8s 等基础设施
- 不做多用户/多租户
- 不修改 OpenCode 源码
- 不部署到云服务器（初期）

## Approval gate
status: awaiting-approval
plan: .omo/plans/opencode-automation.md
waiting-for: user approval to begin Phase 1 execution

#!/usr/bin/env bun
/**
 * PCbot - OpenCode-based automation workhorse system
 *
 * 类似 OpenClaw 的多渠道 AI Agent 自动化网关
 * 基于 OpenCode HTTP API 构建
 */

import { loadConfig, getConfig } from "./config"
import { ServerManager } from "./server/manager"
import { OpenCodeClient } from "./client"
import { TaskStore } from "./engine/store"
import { TaskExecutor } from "./engine/executor"
import { TaskScheduler } from "./engine/scheduler"
import { HealthMonitor } from "./monitor"
import { Logger, globalLogger } from "./monitor/logger"
import { ChannelManager } from "./channels"
import { WebhookChannel } from "./channels/webhook"
import { WeChatChannel } from "./channels/wechat"
import { EvolutionEngine } from "./engine/evolution"
import { TaskRouter } from "./engine/router"
import { HttpApiServer } from "./server/http-api"
import { DiagnosticEngine } from "./engine/diagnostics"
import { TaskDecomposer } from "./engine/decomposer"
import { ResultValidator } from "./engine/validator"
import { Notifier } from "./monitor/notifier"
import { MetricsCollector } from "./monitor/metrics"
import type { ChannelMessage } from "./types"

const logger = new Logger("main")

interface PcbotOptions {
  config?: Record<string, unknown>
  port?: number
  hostname?: string
  wechatApiUrl?: string
  wechatToken?: string
  webhookPort?: number
  apiPort?: number
  enableWebhook?: boolean
  enableWechat?: boolean
  enableApi?: boolean
}

export class Pcbot {
  private serverManager: ServerManager
  private client: OpenCodeClient
  private taskStore: TaskStore
  private taskExecutor: TaskExecutor
  private taskScheduler: TaskScheduler
  private healthMonitor: HealthMonitor
  private channelManager: ChannelManager
  private evolutionEngine: EvolutionEngine
  private taskRouter!: TaskRouter
  private httpApi!: HttpApiServer
  private diagnosticEngine!: DiagnosticEngine
  private taskDecomposer!: TaskDecomposer
  private resultValidator!: ResultValidator
  private notifier!: Notifier
  private metrics!: MetricsCollector
  private startTime = 0
  private running = false
  private options: PcbotOptions

  constructor(options?: PcbotOptions) {
    this.options = options ?? {}
    if (options?.config) {
      loadConfig(options.config as any)
    }

    // Initialize components
    this.serverManager = new ServerManager({
      onListening: (url) => {
        logger.info(`OpenCode server ready: ${url}`)
        this.client.setBaseUrl(url)
      },
      onExit: (code, signal) => {
        logger.warn(`Server exited (${code ?? "unknown"}/${signal ?? "none"})`)
      },
    })

    this.client = new OpenCodeClient()
    this.taskStore = new TaskStore()
    this.taskExecutor = new TaskExecutor(this.client, this.taskStore)
    this.taskScheduler = new TaskScheduler(this.taskStore, this.taskExecutor)
    this.healthMonitor = new HealthMonitor(this.serverManager, this.client)
    this.channelManager = new ChannelManager()
    this.evolutionEngine = new EvolutionEngine(this.taskStore)
    this.diagnosticEngine = new DiagnosticEngine(this.client, this.taskStore)
    this.taskDecomposer = new TaskDecomposer(this.client, this.taskStore, this.taskExecutor)
    this.resultValidator = new ResultValidator(this.client)
    this.notifier = new Notifier(this.channelManager)
    this.metrics = new MetricsCollector(this.taskStore, this.healthMonitor)
  }

  async start(): Promise<void> {
    if (this.running) {
      logger.warn("PCbot already running")
      return
    }

    this.startTime = Date.now()
    this.running = true
    logger.info("=== PCbot Starting ===")

    // 1. Start OpenCode server
    logger.info("Starting OpenCode server...")
    try {
      const url = await this.serverManager.start()
      this.client.setBaseUrl(url)
      logger.info(`OpenCode server ready: ${url}`)
    } catch (err) {
      logger.error(`Failed to start OpenCode server: ${(err as Error).message}`)
      throw err
    }

    // 2. Initialize task router (connects channels to tasks)
    this.taskRouter = new TaskRouter(this.taskStore, this.taskExecutor, this.channelManager)
    this.setupChannelRouting()

    // 3. Start channels
    await this.startChannels()

    // 4. Start HTTP API server (task management UI)
    if (this.options.enableApi !== false) {
      this.httpApi = new HttpApiServer(
        this.taskStore,
        this.taskExecutor,
        this.taskRouter,
        this.evolutionEngine,
        this.healthMonitor,
        this.serverManager,
        this.channelManager,
        this.options.apiPort ?? 8081,
      )
      await this.httpApi.start()
    }

    // 5. Start scheduler
    this.taskScheduler.start()

    // 6. Wire up task event listeners (notifier + metrics)
    this.taskExecutor.onEvent(({ type, exec, task }) => {
      if (type === "complete" || type === "fail") {
        this.metrics.recordTaskComplete(
          exec.completedAt && exec.startedAt
            ? new Date(exec.completedAt).getTime() - new Date(exec.startedAt).getTime()
            : 0,
          type === "complete",
        )
        if (task) {
          this.notifier.notifyTaskComplete(exec, task).catch(() => {})
        }
      }
    })

    // 7. Start health monitor
    this.healthMonitor.start()

    // 7. Start evolution engine
    this.evolutionEngine.start()

    // 8. Enable AI diagnostics (Phase 3)
    this.diagnosticEngine.setEnabled(true)
    this.taskDecomposer.setEnabled(true)
    this.resultValidator.setEnabled(true)

    // 9. Start metrics collection and hourly snapshots (Phase 4)
    setInterval(() => {
      this.metrics.snapshot()
    }, 3_600_000) // Every hour

    // 10. Send daily summary
    setInterval(() => {
      const agg = this.metrics.getAggregate()
      this.notifier.sendDailySummary(
        agg.tasksCompleted,
        agg.tasksFailed,
        this.uptime,
      ).catch(() => {})
    }, 86_400_000) // Every 24h

    logger.info("=== PCbot Started ===")
    this.printStatus()
  }

  private setupChannelRouting(): void {
    // Route webhook messages to tasks
    const webhook = new WebhookChannel(this.options.webhookPort ?? 8080)
    webhook.onMessage((msg) => {
      this.taskRouter.route(msg).catch((err) => {
        logger.error(`Route error: ${(err as Error).message}`)
      })
    })
    this.channelManager.register("webhook", webhook)

    // Route WeChat messages to tasks
    if (this.options.enableWechat || getConfig().channels.wechat?.enabled) {
      const wechat = new WeChatChannel({
        apiUrl: this.options.wechatApiUrl,
        token: this.options.wechatToken,
      })
      wechat.onMessage((msg) => {
        this.taskRouter.route(msg).catch((err) => {
          logger.error(`WeChat route error: ${(err as Error).message}`)
        })
      })
      this.channelManager.register("wechat", wechat)
    }
  }

  private async startChannels(): Promise<void> {
    await this.channelManager.startAll()
    logger.info(`Channels started: ${["stdout", "webhook", this.options.enableWechat ? "wechat" : ""].filter(Boolean).join(", ")}`)
  }

  async stop(): Promise<void> {
    logger.info("=== PCbot Stopping ===")

    this.running = false
    this.evolutionEngine.stop()
    this.healthMonitor.stop()
    this.taskScheduler.stop()
    this.taskExecutor.cancelAll()

    if (this.httpApi) await this.httpApi.stop()
    await this.channelManager.stopAll()
    await this.serverManager.stop()

    logger.info("=== PCbot Stopped ===")
  }

  get uptime(): number {
    if (!this.startTime) return 0
    return Date.now() - this.startTime
  }

  printStatus(): void {
    const uptime = this.uptime
    const hours = Math.floor(uptime / 3600000)
    const minutes = Math.floor((uptime % 3600000) / 60000)
    const seconds = Math.floor((uptime % 60000) / 1000)

    console.log(`
┌──────────────────────────────────────────────┐
│             PCbot 状态报告                     │
├──────────────────────────────────────────────┤
│ 运行时间: ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}
│ Server:    ${this.serverManager.isRunning ? "✅ 运行中" : "❌ 已停止"}
│ Server URL: ${this.serverManager.serverUrl ?? "-"}
│ API客户端: ${this.client.isConfigured ? "✅ 已配置" : "⏳ 等待连接"}
│ HTTP API:  ${this.httpApi ? "✅ 运行中 (port 8081)" : "⏹ 未启用"}
│ 任务引擎:  ${this.taskExecutor.isRunning ? `▶ 执行中 (${this.taskExecutor.runningCount})` : "⏸ 空闲"}
│ 任务总数:  ${this.taskStore.getAllTasks().length}
│ 调度器:    ${this.taskScheduler ? "✅ 运行中" : "⏹ 已停止"}
│ 渠道:      ${this.channelManager ? "✅ 运行中" : "⏹ 已停止"}
│ 监控:      ${this.healthMonitor ? `✅ 运行中 (失败: ${this.healthMonitor.failureCount})` : "⏹ 已停止"}
│ 进化引擎:  ${this.evolutionEngine ? "✅ 运行中" : "⏹ 已停止"}
└──────────────────────────────────────────────┘`)
  }

  getServerManager(): ServerManager { return this.serverManager }
  getClient(): OpenCodeClient { return this.client }
  getTaskStore(): TaskStore { return this.taskStore }
  getTaskExecutor(): TaskExecutor { return this.taskExecutor }
  getHealthMonitor(): HealthMonitor { return this.healthMonitor }
  getChannelManager(): ChannelManager { return this.channelManager }
  getEvolutionEngine(): EvolutionEngine { return this.evolutionEngine }
  getTaskRouter(): TaskRouter { return this.taskRouter }
  getHttpApi(): HttpApiServer { return this.httpApi }
  getDiagnosticEngine(): DiagnosticEngine { return this.diagnosticEngine }
  getTaskDecomposer(): TaskDecomposer { return this.taskDecomposer }
  getResultValidator(): ResultValidator { return this.resultValidator }
  getNotifier(): Notifier { return this.notifier }
  getMetrics(): MetricsCollector { return this.metrics }
}

// ===== CLI Entry =====
async function main() {
  const args = process.argv.slice(2)
  const serveMode = args.includes("--serve") || args.includes("serve")

  if (serveMode) {
    const bot = new Pcbot({
      enableWebhook: true,
      webhookPort: 8080,
      enableApi: true,
      apiPort: 8081,
    })

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\nShutting down...")
      await bot.stop()
      process.exit(0)
    })
    process.on("SIGTERM", async () => {
      await bot.stop()
      process.exit(0)
    })

    await bot.start()

    console.log("\n📡 API Endpoints:")
    console.log("  POST http://localhost:8080/webhook  — Send message to process")
    console.log("  POST http://localhost:8081/api/chat  — Chat-style task creation")
    console.log("  GET  http://localhost:8081/api/status — System status")
    console.log("  GET  http://localhost:8081/api/tasks  — List tasks")
    console.log("  GET  http://localhost:8081/api/evolution — Evolution metrics")
    console.log("")

    // Keep alive
    setInterval(() => {
      bot.printStatus()
    }, 60_000)
  } else {
    // Quick test mode
    const bot = new Pcbot()
    console.log("PCbot initialized. Run with --serve to start the full system.")
    console.log(`Tasks stored at: ${getConfig().tasks.storePath}`)
    console.log(`Log directory: ${getConfig().monitor.logDir}`)
    console.log("\nQuick start:")
    console.log("  bun run dev --serve")
  }
}

// Run if executed directly
const isMain = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")
if (isMain) {
  main().catch((err) => {
    console.error("Fatal error:", err)
    process.exit(1)
  })
}

export { Pcbot as default }

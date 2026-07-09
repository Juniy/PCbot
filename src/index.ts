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

const logger = new Logger("main")

interface PcbotOptions {
  config?: Record<string, unknown>
  port?: number
  hostname?: string
  wechatApiUrl?: string
  wechatToken?: string
  webhookPort?: number
  enableWebhook?: boolean
  enableWechat?: boolean
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
  private startTime = 0
  private running = false

  constructor(options?: PcbotOptions) {
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

    // 2. Start channels
    await this.startChannels()

    // 3. Start scheduler
    this.taskScheduler.start()

    // 4. Start health monitor
    this.healthMonitor.start()

    // 5. Start evolution engine
    this.evolutionEngine.start()

    logger.info("=== PCbot Started ===")
    this.printStatus()
  }

  private async startChannels(): Promise<void> {
    const cfg = getConfig().channels

    // Webhook channel
    if (cfg.webhook?.enabled) {
      const webhookPort = cfg.webhook.port
      const webhook = new WebhookChannel(webhookPort)
      this.channelManager.register("webhook", webhook)
      logger.info(`Webhook channel enabled on port ${webhookPort}`)
    }

    // WeChat channel (via webhook integration)
    if (cfg.wechat?.enabled) {
      const wechat = new WeChatChannel()
      this.channelManager.register("wechat", wechat)
      logger.info("WeChat channel enabled")
    }

    // Start all registered channels
    await this.channelManager.startAll()
  }

  async stop(): Promise<void> {
    logger.info("=== PCbot Stopping ===")

    this.running = false
    this.evolutionEngine.stop()
    this.healthMonitor.stop()
    this.taskScheduler.stop()

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
│ API:       ${this.client.isConfigured ? "✅ 已配置" : "⏳ 等待连接"}
│ 任务引擎:  ${this.taskExecutor.isRunning ? `▶ 执行中 (${this.taskExecutor.runningCount})` : "⏸ 空闲"}
│ 任务总数:  ${this.taskStore.getAllTasks().length}
│ 调度器:    ${this.taskScheduler ? "✅ 运行中" : "⏹ 已停止"}
│ 渠道:      ${this.channelManager ? "✅ 运行中" : "⏹ 已停止"}
│ 监控:      ${this.healthMonitor ? `✅ 运行中 (失败: ${this.healthMonitor.failureCount})` : "⏹ 已停止"}
│ 进化引擎:  ${this.evolutionEngine ? "✅ 运行中" : "⏹ 已停止"}
└──────────────────────────────────────────────┘`)
  }

  getServerManager(): ServerManager {
    return this.serverManager
  }

  getClient(): OpenCodeClient {
    return this.client
  }

  getTaskStore(): TaskStore {
    return this.taskStore
  }

  getTaskExecutor(): TaskExecutor {
    return this.taskExecutor
  }

  getHealthMonitor(): HealthMonitor {
    return this.healthMonitor
  }

  getChannelManager(): ChannelManager {
    return this.channelManager
  }

  getEvolutionEngine(): EvolutionEngine {
    return this.evolutionEngine
  }
}

// ===== CLI Entry =====
async function main() {
  const args = process.argv.slice(2)
  const serveMode = args.includes("--serve") || args.includes("serve")

  if (serveMode) {
    const bot = new Pcbot({
      enableWebhook: true,
      webhookPort: 8080,
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

    // Keep alive
    setInterval(() => {
      bot.printStatus()
    }, 60_000)
  } else {
    // Quick test mode: just verify config and connectivity
    const bot = new Pcbot()
    console.log("PCbot initialized. Run with --serve to start the full system.")
    console.log(`Tasks stored at: ${getConfig().tasks.storePath}`)
    console.log(`Log directory: ${getConfig().monitor.logDir}`)

    // Show example task creation
    console.log("\nExample: Create a task via API")
    console.log("  POST http://localhost:8080/webhook with JSON body { \"content\": \"your prompt\" }")
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

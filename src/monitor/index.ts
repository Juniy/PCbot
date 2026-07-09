import { Logger } from "./logger"
import { getConfig } from "../config"
import { ServerManager } from "../server/manager"
import { OpenCodeClient } from "../client"
import type { HealthStatus } from "../types"

export class HealthMonitor {
  private server: ServerManager
  private client: OpenCodeClient
  private logger = new Logger("health-monitor")
  private timerId: ReturnType<typeof setInterval> | null = null
  private healthHistory: HealthStatus[] = []
  private consecutiveFailures = 0
  private restartCount = 0
  private totalRestarts = 0
  private maxRestarts: number
  private backoffSchedule: number[]

  constructor(server: ServerManager, client: OpenCodeClient) {
    this.server = server
    this.client = client
    const cfg = getConfig().monitor
    this.maxRestarts = getConfig().server.maxRestarts
    this.backoffSchedule = cfg.restartBackoffMs
  }

  get history(): HealthStatus[] {
    return [...this.healthHistory]
  }

  get failureCount(): number {
    return this.consecutiveFailures
  }

  get restartAttempts(): number {
    return this.totalRestarts
  }

  start(): void {
    if (this.timerId) return
    const interval = getConfig().monitor.intervalMs
    this.logger.info(`Health monitor started (interval: ${interval}ms)`)

    this.timerId = setInterval(() => {
      this.check().catch((err) => {
        this.logger.error(`Health check error: ${(err as Error).message}`)
      })
    }, interval)

    // Immediate first check
    this.check().catch(() => {})
  }

  stop(): void {
    if (this.timerId) {
      clearInterval(this.timerId)
      this.timerId = null
    }
    this.logger.info("Health monitor stopped")
  }

  private async check(): Promise<void> {
    const startTime = Date.now()
    const serverRunning = this.server.isRunning
    let apiReachable = false
    let responseTime = 0

    if (serverRunning && this.server.serverUrl) {
      const health = await this.server.healthCheck()
      apiReachable = health.ok
      responseTime = health.responseTime
    }

    const status: HealthStatus = {
      serverRunning,
      apiReachable,
      lastCheck: new Date().toISOString(),
      uptime: this.server.uptime,
      responseTime,
      memoryMB: process.memoryUsage().heapUsed / 1024 / 1024,
      errorCount: this.consecutiveFailures,
    }

    this.healthHistory.push(status)
    // Keep last 100 entries
    if (this.healthHistory.length > 100) {
      this.healthHistory.shift()
    }

    if (!serverRunning || !apiReachable) {
      this.consecutiveFailures++
      this.logger.warn(
        `Health check FAILED (${this.consecutiveFailures}x): server=${serverRunning}, api=${apiReachable}`,
      )
      await this.handleFailure()
    } else {
      if (this.consecutiveFailures > 0) {
        this.logger.info("Health check recovered")
      }
      this.consecutiveFailures = 0
      this.restartCount = 0
    }
  }

  private async handleFailure(): Promise<void> {
    if (!getConfig().server.autoRestart) return

    if (this.restartCount >= this.maxRestarts) {
      this.logger.error(
        `Auto-restart limit reached (${this.maxRestarts}x). Manual intervention required.`,
      )
      return
    }

    const backoffIndex = Math.min(this.restartCount, this.backoffSchedule.length - 1)
    const delay = this.backoffSchedule[backoffIndex] ?? 60_000
    this.restartCount++
    this.totalRestarts++

    this.logger.info(
      `Auto-restart attempt ${this.restartCount}/${this.maxRestarts} in ${delay}ms...`,
    )

    await new Promise((r) => setTimeout(r, delay))

    try {
      const url = await this.server.restart()
      this.client.setBaseUrl(url)
      this.logger.info(`Server restarted successfully on ${url}`)
    } catch (err) {
      this.logger.error(`Restart failed: ${(err as Error).message}`)
    }
  }
}

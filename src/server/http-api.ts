import * as http from "http"
import * as fs from "fs"
import * as path from "path"
import { Logger } from "../monitor/logger"
import { TaskStore } from "../engine/store"
import { TaskExecutor } from "../engine/executor"
import { TaskRouter } from "../engine/router"
import { EvolutionEngine } from "../engine/evolution"
import { MetricsCollector } from "../monitor/metrics"
import { HealthMonitor } from "../monitor"
import { ServerManager } from "./manager"
import { ChannelManager } from "../channels"
import { ulid } from "../engine/ulid"
import { getConfig, updateConfig } from "../config"
import { getRecentLogs, subscribeLogs } from "../monitor/logger"
import type { TaskDefinition, TaskStep, AgentID } from "../types"

const KNOWN_AGENTS: AgentID[] = [
  "sisyphus", "hephaestus", "oracle", "explore",
  "multimodal-looker", "prometheus", "metis", "momus",
  "atlas", "sisyphus-junior", "build",
]

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

const FRONTEND_DIR = path.resolve(process.cwd(), "frontend")

export class HttpApiServer {
  private server: http.Server
  private logger = new Logger("http-api")
  private port: number

  constructor(
    private taskStore: TaskStore,
    private taskExecutor: TaskExecutor,
    private taskRouter: TaskRouter,
    private evolution: EvolutionEngine,
    private healthMonitor: HealthMonitor,
    private serverManager: ServerManager,
    private channelManager: ChannelManager,
    private metrics?: MetricsCollector,
    port = 8081,
  ) {
    this.port = port
    this.server = http.createServer((req, res) => this.handleRequest(req, res))
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, "127.0.0.1", () => {
        this.logger.info(`HTTP API listening on http://127.0.0.1:${this.port}`)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve())
    })
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return }

    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
      const pathname = url.pathname
      const method = req.method ?? "GET"

      // ===== SSE Event Stream =====
      if (pathname === "/api/events" && method === "GET") {
        this.handleSSE(req, res)
        return
      }

      // ===== REST API Routes =====
      if (pathname === "/api/status" && method === "GET") { await this.handleStatus(res); return }
      if (pathname === "/api/health" && method === "GET") { await this.handleHealth(res); return }
      if (pathname === "/api/tasks" && method === "GET") { await this.handleListTasks(res); return }
      if (pathname === "/api/tasks" && method === "POST") { await this.handleCreateTask(req, res); return }
      if (pathname.startsWith("/api/tasks/") && method === "GET") { await this.handleGetTask(pathname, res); return }
      if (pathname.startsWith("/api/tasks/") && method === "DELETE") { await this.handleDeleteTask(pathname, res); return }
      if (pathname === "/api/executions" && method === "GET") { await this.handleListExecutions(url, res); return }
      if (pathname === "/api/evolution" && method === "GET") { await this.handleEvolution(res); return }
      if (pathname === "/api/metrics" && method === "GET") { await this.handleMetrics(res); return }
      if (pathname === "/api/chat" && method === "POST") { await this.handleChat(req, res); return }
      if (pathname === "/api/agents" && method === "GET") { await this.handleAgents(res); return }
      if (pathname === "/api/config" && method === "GET") { await this.handleGetConfig(res); return }
      if (pathname === "/api/config" && method === "PUT") { await this.handleUpdateConfig(req, res); return }
      if (pathname === "/api/logs" && method === "GET") { await this.handleLogs(url, res); return }

      // ===== Static Files (frontend) =====
      if (method === "GET" && !pathname.startsWith("/api")) {
        await this.serveStatic(pathname, res)
        return
      }

      await this.json(res, 404, { error: "Not found" })
    } catch (err) {
      this.logger.error(`API error: ${(err as Error).message}`)
      if (!res.headersSent) await this.json(res, 500, { error: (err as Error).message })
    }
  }

  // ==================== SSE ====================

  private handleSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    })

    // Send initial snapshot
    const snapshot = {
      type: "snapshot",
      status: this.buildStatusPayload(),
      logs: getRecentLogs(200),
    }
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`)

    // Subscribe to new log entries
    const unsub = subscribeLogs((entry) => {
      try {
        res.write(`data: ${JSON.stringify({ type: "log", entry })}\n\n`)
      } catch { unsub() }
    })

    // Periodic status heartbeat
    const heartbeat = setInterval(() => {
      try {
        res.write(`data: ${JSON.stringify({ type: "heartbeat", status: this.buildStatusPayload() })}\n\n`)
      } catch { clearInterval(heartbeat); unsub() }
    }, 5000)

    req.on("close", () => { clearInterval(heartbeat); unsub() })
  }

  // ==================== Handlers ====================

  private buildStatusPayload(): any {
    const wechatCfg = getConfig().channels.wechat
    return {
      server: {
        running: this.serverManager.isRunning,
        url: this.serverManager.serverUrl,
        uptime: this.serverManager.uptime,
      },
      tasks: {
        total: this.taskStore.getAllTasks().length,
        running: this.taskExecutor.runningCount,
      },
      monitor: {
        consecutiveFailures: this.healthMonitor.failureCount,
        restarts: this.healthMonitor.restartAttempts,
        hasMemoryLeak: this.healthMonitor.hasMemoryLeak,
      },
      config: {
        defaultAgent: getConfig().tasks.defaultAgent,
        watchdogEnabled: getConfig().monitor.watchdogEnabled,
      },
      agents: KNOWN_AGENTS,
      channels: {
        registered: Array.from((this.channelManager as any).adapters.keys()),
        wechat: wechatCfg?.enabled ? { mode: wechatCfg.mode, hasGateway: !!wechatCfg.gatewayUrl } : null,
      },
    }
  }

  private async handleStatus(res: http.ServerResponse): Promise<void> {
    await this.json(res, 200, this.buildStatusPayload())
  }

  private async handleHealth(res: http.ServerResponse): Promise<void> {
    await this.json(res, 200, {
      status: "ok",
      serverRunning: this.serverManager.isRunning,
      timestamp: new Date().toISOString(),
    })
  }

  private async handleListTasks(res: http.ServerResponse): Promise<void> {
    const tasks = this.taskStore.getAllTasks()
    await this.json(res, 200, { data: tasks })
  }

  private async handleCreateTask(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req)
    const task = JSON.parse(body) as TaskDefinition
    task.id = task.id ?? ulid()
    task.createdAt = task.createdAt ?? new Date().toISOString()
    task.updatedAt = task.updatedAt ?? new Date().toISOString()
    this.taskStore.addTask(task)
    await this.json(res, 201, { data: task })
  }

  private async handleGetTask(pathname: string, res: http.ServerResponse): Promise<void> {
    const id = pathname.slice("/api/tasks/".length)
    const task = this.taskStore.getTask(id)
    if (!task) { await this.json(res, 404, { error: "Task not found" }); return }
    const executions = this.taskStore.getExecutionsByTask(id)
    await this.json(res, 200, { data: task, executions })
  }

  private async handleDeleteTask(pathname: string, res: http.ServerResponse): Promise<void> {
    const id = pathname.slice("/api/tasks/".length)
    const deleted = this.taskStore.deleteTask(id)
    await this.json(res, deleted ? 200 : 404, { deleted })
  }

  private async handleListExecutions(url: URL, res: http.ServerResponse): Promise<void> {
    const limit = parseInt(url.searchParams.get("limit") ?? "20", 10)
    const executions = this.taskStore.getRecentExecutions(limit)
    await this.json(res, 200, { data: executions })
  }

  private async handleEvolution(res: http.ServerResponse): Promise<void> {
    await this.json(res, 200, {
      metrics: this.evolution.getMetrics(),
      summary: this.evolution.getSummary(),
    })
  }

  private async handleMetrics(res: http.ServerResponse): Promise<void> {
    await this.json(res, 200, {
      aggregate: this.metrics?.getAggregate() ?? null,
      summary: this.metrics?.getSummary() ?? "Metrics not available",
    })
  }

  private async handleChat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req)
    const data = JSON.parse(body)
    const content = data.content ?? data.text ?? data.message ?? ""
    const channel = data.channel ?? "webhook"
    const from = data.from ?? "api"
    const msg: import("../types").ChannelMessage = {
      id: ulid(), channel: channel as any, from, content,
      timestamp: new Date().toISOString(),
    }
    const taskId = await this.taskRouter.route(msg)
    await this.json(res, 201, { taskId, message: "Task created" })
  }

  private async handleAgents(res: http.ServerResponse): Promise<void> {
    await this.json(res, 200, {
      available: KNOWN_AGENTS,
      default: getConfig().tasks.defaultAgent,
      stepTypeMapping: {
        prompt: "sisyphus-junior",
        session_command: "sisyphus-junior",
        shell_command: "hephaestus",
        file_operation: "hephaestus",
      },
    })
  }

  // ==================== Config API ====================

  private async handleGetConfig(res: http.ServerResponse): Promise<void> {
    const cfg = getConfig()
    // Return a sanitized copy (mask secrets)
    const safe = JSON.parse(JSON.stringify(cfg))
    if (safe.channels?.wechat?.gatewayToken) safe.channels.wechat.gatewayToken = "****"
    await this.json(res, 200, { data: safe })
  }

  private async handleUpdateConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req)
    const partial = JSON.parse(body)
    const updated = updateConfig(partial)
    const safe = JSON.parse(JSON.stringify(updated))
    if (safe.channels?.wechat?.gatewayToken) safe.channels.wechat.gatewayToken = "****"
    await this.json(res, 200, { data: safe })
  }

  // ==================== Logs API ====================

  private async handleLogs(url: URL, res: http.ServerResponse): Promise<void> {
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200", 10), 1000)
    const level = url.searchParams.get("level") ?? ""
    let logs = getRecentLogs(limit)
    if (level) logs = logs.filter((l) => l.level === level)
    await this.json(res, 200, { data: logs })
  }

  // ==================== Static File Server ====================

  private async serveStatic(urlPath: string, res: http.ServerResponse): Promise<void> {
    // Default to index.html
    let filePath = urlPath === "/" ? "/index.html" : urlPath
    filePath = path.join(FRONTEND_DIR, filePath)

    // Security: prevent directory traversal
    if (!filePath.startsWith(FRONTEND_DIR)) {
      res.writeHead(403); res.end("Forbidden")
      return
    }

    try {
      const content = fs.readFileSync(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream"
      res.writeHead(200, { "Content-Type": contentType })
      res.end(content)
    } catch {
      // Fallback: serve index.html for SPA routing
      try {
        const idx = path.join(FRONTEND_DIR, "index.html")
        if (fs.existsSync(idx)) {
          const content = fs.readFileSync(idx)
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          res.end(content)
        } else {
          res.writeHead(404); res.end("Not found")
        }
      } catch {
        res.writeHead(404); res.end("Not found")
      }
    }
  }

  // ==================== Helpers ====================

  private async json(res: http.ServerResponse, status: number, data: unknown): Promise<void> {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(data))
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = ""
      req.on("data", (chunk) => (data += chunk))
      req.on("end", () => resolve(data))
      req.on("error", reject)
    })
  }
}

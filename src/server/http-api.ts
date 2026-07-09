import * as http from "http"
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
import type { TaskDefinition, TaskStep } from "../types"

/**
 * Built-in HTTP API for task management and system status
 *
 * Endpoints:
 *  GET    /api/status       — System status
 *  GET    /api/tasks        — List all tasks
 *  GET    /api/tasks/:id    — Get task details
 *  POST   /api/tasks        — Create a task
 *  DELETE /api/tasks/:id    — Delete a task
 *  GET    /api/executions   — Recent execution history
 *  GET    /api/evolution    — Evolution engine metrics
 *  GET    /api/health       — Health check
 *  POST   /api/chat         — Chat-style message → task
 */
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
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")

    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
      const path = url.pathname
      const method = req.method ?? "GET"

      // Route
      if (path === "/api/status" && method === "GET") {
        await this.json(res, 200, {
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
          },
          channels: ["stdout", "webhook", "wechat"],
        })
        return
      }

      if (path === "/api/tasks" && method === "GET") {
        const tasks = this.taskStore.getAllTasks()
        await this.json(res, 200, { data: tasks })
        return
      }

      if (path === "/api/tasks" && method === "POST") {
        const body = await this.readBody(req)
        const task = JSON.parse(body) as TaskDefinition
        task.id = task.id ?? ulid()
        task.createdAt = task.createdAt ?? new Date().toISOString()
        task.updatedAt = task.updatedAt ?? new Date().toISOString()
        this.taskStore.addTask(task)
        await this.json(res, 201, { data: task })
        return
      }

      if (path.startsWith("/api/tasks/") && method === "GET") {
        const id = path.slice("/api/tasks/".length)
        const task = this.taskStore.getTask(id)
        if (!task) {
          await this.json(res, 404, { error: "Task not found" })
          return
        }
        const executions = this.taskStore.getExecutionsByTask(id)
        await this.json(res, 200, { data: task, executions })
        return
      }

      if (path.startsWith("/api/tasks/") && method === "DELETE") {
        const id = path.slice("/api/tasks/".length)
        const deleted = this.taskStore.deleteTask(id)
        await this.json(res, deleted ? 200 : 404, { deleted })
        return
      }

      if (path === "/api/executions" && method === "GET") {
        const limit = parseInt(url.searchParams.get("limit") ?? "20", 10)
        const executions = this.taskStore.getRecentExecutions(limit)
        await this.json(res, 200, { data: executions })
        return
      }

      if (path === "/api/evolution" && method === "GET") {
        await this.json(res, 200, {
          metrics: this.evolution.getMetrics(),
          summary: this.evolution.getSummary(),
        })
        return
      }

      if (path === "/api/metrics" && method === "GET") {
        await this.json(res, 200, {
          aggregate: this.metrics?.getAggregate() ?? null,
          summary: this.metrics?.getSummary() ?? "Metrics not available",
        })
        return
      }

      if (path === "/api/health" && method === "GET") {
        await this.json(res, 200, {
          status: "ok",
          serverRunning: this.serverManager.isRunning,
          timestamp: new Date().toISOString(),
        })
        return
      }

      if (path === "/api/chat" && method === "POST") {
        const body = await this.readBody(req)
        const data = JSON.parse(body)
        const content = data.content ?? data.text ?? data.message ?? ""
        const channel = data.channel ?? "webhook"
        const from = data.from ?? "api"

        const msg: import("../types").ChannelMessage = {
          id: ulid(),
          channel: channel as any,
          from,
          content,
          timestamp: new Date().toISOString(),
        }

        const taskId = await this.taskRouter.route(msg)
        await this.json(res, 201, { taskId, message: "Task created" })
        return
      }

      // 404
      await this.json(res, 404, { error: "Not found" })
    } catch (err) {
      this.logger.error(`API error: ${(err as Error).message}`)
      await this.json(res, 500, { error: (err as Error).message })
    }
  }

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

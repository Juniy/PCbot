import * as fs from "fs"
import * as path from "path"
import { getConfig } from "../config"
import { Logger } from "../monitor/logger"
import type { TaskDefinition, TaskExecution } from "../types"

export class TaskStore {
  private tasks: Map<string, TaskDefinition> = new Map()
  private executions: Map<string, TaskExecution> = new Map()
  private storePath: string
  private logger = new Logger("task-store")

  constructor() {
    this.storePath = getConfig().tasks.storePath
    this.load()
  }

  private ensureDir(): void {
    const dir = path.dirname(this.storePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  private load(): void {
    try {
      this.ensureDir()
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, "utf-8")
        const data = JSON.parse(raw)
        if (data.tasks) {
          for (const t of data.tasks) {
            this.tasks.set(t.id, t)
          }
        }
        if (data.executions) {
          for (const e of data.executions) {
            this.executions.set(e.id, e)
          }
        }
        this.logger.info(`Loaded ${this.tasks.size} tasks, ${this.executions.size} executions from store`)
      }
    } catch (err) {
      this.logger.warn(`Failed to load task store: ${(err as Error).message}, starting fresh`)
    }
  }

  private save(): void {
    try {
      this.ensureDir()
      const data = {
        tasks: Array.from(this.tasks.values()),
        executions: Array.from(this.executions.values()).slice(-getConfig().tasks.maxHistory),
      }
      fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2), "utf-8")
    } catch (err) {
      this.logger.error(`Failed to save task store: ${(err as Error).message}`)
    }
  }

  // ===== Task CRUD =====
  addTask(task: TaskDefinition): void {
    this.tasks.set(task.id, task)
    this.save()
  }

  getTask(id: string): TaskDefinition | undefined {
    return this.tasks.get(id)
  }

  getAllTasks(): TaskDefinition[] {
    return Array.from(this.tasks.values())
  }

  updateTask(id: string, updates: Partial<TaskDefinition>): TaskDefinition | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined
    Object.assign(task, updates, { updatedAt: new Date().toISOString() })
    this.save()
    return task
  }

  deleteTask(id: string): boolean {
    const deleted = this.tasks.delete(id)
    if (deleted) this.save()
    return deleted
  }

  findTasksByTag(tag: string): TaskDefinition[] {
    return this.getAllTasks().filter((t) => t.tags?.includes(tag))
  }

  getScheduledTasks(): TaskDefinition[] {
    return this.getAllTasks().filter((t) => t.schedule !== undefined)
  }

  // ===== Execution CRUD =====
  addExecution(exec: TaskExecution): void {
    this.executions.set(exec.id, exec)
    this.save()
  }

  getExecution(id: string): TaskExecution | undefined {
    return this.executions.get(id)
  }

  updateExecution(id: string, updates: Partial<TaskExecution>): TaskExecution | undefined {
    const exec = this.executions.get(id)
    if (!exec) return undefined
    Object.assign(exec, updates)
    this.save()
    return exec
  }

  getExecutionsByTask(taskId: string): TaskExecution[] {
    return Array.from(this.executions.values())
      .filter((e) => e.taskId === taskId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  getRecentExecutions(limit = 20): TaskExecution[] {
    return Array.from(this.executions.values())
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit)
  }
}

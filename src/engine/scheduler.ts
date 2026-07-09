import { Logger } from "../monitor/logger"
import { TaskStore } from "./store"
import { TaskExecutor } from "./executor"

/**
 * Simple cron expression matcher (sync, no external deps)
 * Supports: star, star/N, N,M, N-M ranges for 5 fields:
 * minute hour day-of-month month day-of-week
 */
export function matchCron(expression: string, date: Date = new Date()): boolean {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return false

  const [minField, hourField, domField, monField, dowField] = parts

  const matchField = (field: string, value: number): boolean => {
    if (field === "*") return true
    if (field.startsWith("*/")) {
      const step = parseInt(field.slice(2), 10)
      if (isNaN(step)) return false
      return value % step === 0
    }
    if (field.includes(",")) {
      return field.split(",").map(Number).includes(value)
    }
    if (field.includes("-")) {
      const [lo, hi] = field.split("-").map(Number)
      if (lo === undefined || hi === undefined) return false
      return value >= lo && value <= hi
    }
    return parseInt(field, 10) === value
  }

  return (
    matchField(minField!, date.getMinutes()) &&
    matchField(hourField!, date.getHours()) &&
    matchField(domField!, date.getDate()) &&
    matchField(monField!, date.getMonth() + 1) &&
    matchField(dowField!, date.getDay())
  )
}

function simpleCronMatch(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return false

  const [min, hour, dom, mon, dow] = parts

  const matchField = (field: string, value: number): boolean => {
    if (field === "*") return true
    if (field.startsWith("*/")) {
      const step = parseInt(field.slice(2), 10)
      if (isNaN(step)) return false
      return value % step === 0
    }
    if (field.includes(",")) {
      return field.split(",").map(Number).includes(value)
    }
    if (field.includes("-")) {
      const [lo, hi] = field.split("-").map(Number)
      if (lo === undefined || hi === undefined) return false
      return value >= lo && value <= hi
    }
    return parseInt(field, 10) === value
  }

  return (
    matchField(min!, date.getMinutes()) &&
    matchField(hour!, date.getHours()) &&
    matchField(dom!, date.getDate()) &&
    matchField(mon!, date.getMonth() + 1) &&
    matchField(dow!, date.getDay())
  )
}

export class TaskScheduler {
  private store: TaskStore
  private executor: TaskExecutor
  private logger = new Logger("task-scheduler")
  private timerId: ReturnType<typeof setInterval> | null = null
  private lastCheck: Date = new Date()
  private checkIntervalMs = 30_000 // Check every 30s

  constructor(store: TaskStore, executor: TaskExecutor) {
    this.store = store
    this.executor = executor
  }

  start(): void {
    if (this.timerId) return
    this.logger.info("Task scheduler started (check interval: 30s)")

    this.timerId = setInterval(() => {
      this.checkScheduledTasks().catch((err) => {
        this.logger.error(`Scheduler check failed: ${(err as Error).message}`)
      })
    }, this.checkIntervalMs)
  }

  stop(): void {
    if (this.timerId) {
      clearInterval(this.timerId)
      this.timerId = null
    }
    this.logger.info("Task scheduler stopped")
  }

  private async checkScheduledTasks(): Promise<void> {
    const now = new Date()
    const scheduled = this.store.getScheduledTasks()

    for (const task of scheduled) {
      if (!task.schedule) continue

      try {
        if (matchCron(task.schedule, now)) {
          this.logger.info(`Triggering scheduled task "${task.name}" (schedule: ${task.schedule})`)

          // Don't start if already running
          const recent = this.store.getExecutionsByTask(task.id)
          const isRunning = recent.some(
            (e) => e.status === "running" && Date.now() - new Date(e.startedAt).getTime() < 60_000,
          )
          if (isRunning) {
            this.logger.debug(`Task "${task.name}" already running, skipping`)
            continue
          }

          // Execute in background
          this.executor.executeTask(task).catch((err) => {
            this.logger.error(`Scheduled task "${task.name}" error: ${(err as Error).message}`)
          })
        }
      } catch (err) {
        this.logger.error(`Error processing schedule for "${task.name}": ${(err as Error).message}`)
      }
    }
  }
}

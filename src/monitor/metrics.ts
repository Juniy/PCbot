import { Logger } from "./logger"
import { TaskStore } from "../engine/store"
import { HealthMonitor } from "./index"

/**
 * Performance Metrics Collector
 *
 * Tracks system-wide performance metrics:
 * - Task throughput
 * - Average response times
 * - Error rates
 * - Resource usage trends
 */
export class MetricsCollector {
  private store: TaskStore
  private healthMonitor: HealthMonitor
  private logger = new Logger("metrics")

  // Time-series data
  private hourlySnapshots: HourlyMetrics[] = []
  private currentHour: HourlyMetrics

  constructor(store: TaskStore, healthMonitor: HealthMonitor) {
    this.store = store
    this.healthMonitor = healthMonitor
    this.currentHour = this.createSnapshot()
  }

  private createSnapshot(): HourlyMetrics {
    return {
      timestamp: new Date().toISOString(),
      tasksStarted: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      averageDuration: 0,
      totalDuration: 0,
      healthFailures: 0,
      serverRestarts: 0,
      errorCount: 0,
    }
  }

  recordTaskStart(): void {
    this.currentHour.tasksStarted++
  }

  recordTaskComplete(durationMs: number, success: boolean): void {
    if (success) {
      this.currentHour.tasksCompleted++
    } else {
      this.currentHour.tasksFailed++
    }
    this.currentHour.totalDuration += durationMs
    this.currentHour.averageDuration =
      this.currentHour.totalDuration / (this.currentHour.tasksCompleted + this.currentHour.tasksFailed)
  }

  recordError(): void {
    this.currentHour.errorCount++
    this.currentHour.healthFailures = this.healthMonitor.failureCount
  }

  recordServerRestart(): void {
    this.currentHour.serverRestarts++
  }

  /**
   * Called every hour to snapshot current metrics
   */
  snapshot(): void {
    this.hourlySnapshots.push({ ...this.currentHour })
    if (this.hourlySnapshots.length > 24 * 7) {
      // Keep 7 days
      this.hourlySnapshots.shift()
    }
    this.currentHour = this.createSnapshot()
  }

  /**
   * Get metrics for the last N hours
   */
  getRecent(hours = 24): HourlyMetrics[] {
    return this.hourlySnapshots.slice(-hours)
  }

  /**
   * Get current aggregate metrics
   */
  getAggregate(): AggregateMetrics {
    const recent = this.getRecent(24)
    const totalStarted = recent.reduce((s, h) => s + h.tasksStarted, 0)
    const totalCompleted = recent.reduce((s, h) => s + h.tasksCompleted, 0)
    const totalFailed = recent.reduce((s, h) => s + h.tasksFailed, 0)
    const durations = recent.filter((h) => h.averageDuration > 0)

    // Get recent executions for real-time data
    const recentExecs = this.store.getRecentExecutions(50)
    const completedExecs = recentExecs.filter((e) => e.status === "completed").length
    const failedExecs = recentExecs.filter((e) => e.status === "failed").length
    const avgDuration = recentExecs
      .filter((e) => e.completedAt && e.startedAt)
      .map((e) => new Date(e.completedAt!).getTime() - new Date(e.startedAt).getTime())

    return {
      period: "24h",
      tasksStarted: totalStarted,
      tasksCompleted: totalCompleted,
      tasksFailed: totalFailed,
      successRate: totalCompleted + totalFailed > 0
        ? totalCompleted / (totalCompleted + totalFailed)
        : 1,
      averageDurationMs: avgDuration.length > 0
        ? avgDuration.reduce((a, b) => a + b, 0) / avgDuration.length
        : 0,
      recentExecutions: recentExecs.length,
      recentSuccessRate: completedExecs + failedExecs > 0
        ? completedExecs / (completedExecs + failedExecs)
        : 1,
      serverRestarts: recent.reduce((s, h) => s + h.serverRestarts, 0),
      healthFailures: recent.reduce((s, h) => s + h.healthFailures, 0),
      currentHealthFailures: this.healthMonitor.failureCount,
      snapshotCount: this.hourlySnapshots.length,
    }
  }

  getSummary(): string {
    const agg = this.getAggregate()
    return [
      `=== Performance Metrics ===`,
      `Period: ${agg.period}`,
      `Tasks: ${agg.tasksCompleted} completed, ${agg.tasksFailed} failed`,
      `Success Rate: ${(agg.successRate * 100).toFixed(1)}%`,
      `Avg Duration: ${(agg.averageDurationMs / 1000).toFixed(1)}s`,
      `Server Restarts: ${agg.serverRestarts}`,
      `Health Failures: ${agg.healthFailures}`,
      `==========================`,
    ].join("\n")
  }
}

export interface HourlyMetrics {
  timestamp: string
  tasksStarted: number
  tasksCompleted: number
  tasksFailed: number
  averageDuration: number
  totalDuration: number
  healthFailures: number
  serverRestarts: number
  errorCount: number
}

export interface AggregateMetrics {
  period: string
  tasksStarted: number
  tasksCompleted: number
  tasksFailed: number
  successRate: number
  averageDurationMs: number
  recentExecutions: number
  recentSuccessRate: number
  serverRestarts: number
  healthFailures: number
  currentHealthFailures: number
  snapshotCount: number
}

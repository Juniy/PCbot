import { Logger } from "../monitor/logger"
import { TaskStore } from "./store"
import type { TaskExecution, TaskDefinition, TaskStep } from "../types"

/**
 * Self-Evolution Engine
 *
 * Analyzes task execution history to:
 * 1. Detect frequently failing steps → suggest schedule changes
 * 2. Detect slow steps → suggest timeout adjustments
 * 3. Identify optimal task ordering → reorder for efficiency
 * 4. Suggest retry strategy improvements
 */
export class EvolutionEngine {
  private store: TaskStore
  private logger = new Logger("evolution-engine")
  private analysisInterval: ReturnType<typeof setInterval> | null = null

  // Learning metrics
  private metrics = {
    totalExecutions: 0,
    successRate: 1.0,
    averageDuration: 0,
    failurePatterns: new Map<string, number>(), // step name → failure count
    stepDurations: new Map<string, number[]>(),
    optimizationApplied: 0,
  }

  constructor(store: TaskStore) {
    this.store = store
  }

  start(intervalMs = 300_000): void {
    // Analyze every 5 minutes
    this.analysisInterval = setInterval(() => {
      this.analyze().catch((err) => {
        this.logger.error(`Evolution analysis failed: ${(err as Error).message}`)
      })
    }, intervalMs)

    // Initial analysis
    this.analyze().catch(() => {})
    this.logger.info(`Evolution engine started (analysis interval: ${intervalMs}ms)`)
  }

  stop(): void {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval)
      this.analysisInterval = null
    }
  }

  private async analyze(): Promise<void> {
    const recent = this.store.getRecentExecutions(100)
    if (recent.length === 0) return

    this.metrics.totalExecutions = recent.length

    // Calculate success rate
    const completed = recent.filter((e) => e.status === "completed").length
    this.metrics.successRate = completed / recent.length

    // Calculate average duration
    const durations = recent
      .filter((e) => e.completedAt && e.startedAt)
      .map((e) => new Date(e.completedAt!).getTime() - new Date(e.startedAt).getTime())
    if (durations.length > 0) {
      this.metrics.averageDuration = durations.reduce((a, b) => a + b, 0) / durations.length
    }

    // Analyze failures
    for (const exec of recent) {
      if (exec.status === "failed") {
        for (const step of exec.stepResults) {
          if (step.status === "failed") {
            const key = `${exec.taskId}:${step.stepId}`
            this.metrics.failurePatterns.set(key, (this.metrics.failurePatterns.get(key) ?? 0) + 1)
          }
        }
      }

      // Track step durations
      for (const step of exec.stepResults) {
        if (step.duration > 0) {
          const key = `${exec.taskId}:${step.stepId}`
          const existing = this.metrics.stepDurations.get(key) ?? []
          existing.push(step.duration)
          // Keep last 20
          if (existing.length > 20) existing.shift()
          this.metrics.stepDurations.set(key, existing)
        }
      }
    }

    // Apply optimizations based on patterns
    await this.applyOptimizations()

    this.logger.debug(
      `Analysis: success=${(this.metrics.successRate * 100).toFixed(1)}%, ` +
        `avgDuration=${(this.metrics.averageDuration / 1000).toFixed(1)}s, ` +
        `failurePatterns=${this.metrics.failurePatterns.size}, ` +
        `optimizations=${this.metrics.optimizationApplied}`,
    )
  }

  private async applyOptimizations(): Promise<void> {
    for (const [key, count] of this.metrics.failurePatterns) {
      if (count >= 2) {
        const [taskId, stepId] = key.split(":") as [string, string]
        const task = this.store.getTask(taskId)
        if (!task) continue

        const step = task.steps.find((s) => s.id === stepId)
        if (!step) continue

        const durations = this.metrics.stepDurations.get(key)
        const avgDuration = durations && durations.length > 0
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : 0

        // Optimization: increase timeout for slow steps
        if (avgDuration > 0 && step.timeout && step.timeout < avgDuration * 2) {
          const newTimeout = Math.round(avgDuration * 3)
          step.timeout = newTimeout
          this.store.updateTask(taskId, { steps: task.steps })
          this.metrics.optimizationApplied++
          this.logger.info(
            `Optimization: increased timeout for "${task.name}:${step.name}" to ${newTimeout}ms ` +
              `(avg duration: ${avgDuration.toFixed(0)}ms, failures: ${count})`,
          )
        }

        // Optimization: increase max retries for persistently failing steps
        if (count >= 3 && (step.maxRetries ?? task.maxRetries) < 3) {
          step.maxRetries = 3
          this.store.updateTask(taskId, { steps: task.steps })
          this.metrics.optimizationApplied++
          this.logger.info(
            `Optimization: increased maxRetries for "${task.name}:${step.name}" to 3`,
          )
        }
      }
    }
  }

  getMetrics() {
    return { ...this.metrics, failurePatterns: Array.from(this.metrics.failurePatterns.entries()) }
  }

  getSummary(): string {
    const m = this.metrics
    return [
      `=== Evolution Engine Summary ===`,
      `Total Executions: ${m.totalExecutions}`,
      `Success Rate: ${(m.successRate * 100).toFixed(1)}%`,
      `Average Duration: ${(m.averageDuration / 1000).toFixed(1)}s`,
      `Active Failure Patterns: ${m.failurePatterns.size}`,
      `Optimizations Applied: ${m.optimizationApplied}`,
      `===============================`,
    ].join("\n")
  }
}

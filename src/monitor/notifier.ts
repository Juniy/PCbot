import { Logger } from "./logger"
import { ChannelManager } from "../channels"
import { ulid } from "../engine/ulid"
import type { ChannelMessage, TaskExecution, TaskDefinition } from "../types"

/**
 * Multi-channel Notification System
 *
 * Automatically sends notifications when:
 * - Task completes successfully
 * - Task fails
 * - Server restarts
 * - Health check fails
 */
export class Notifier {
  private channels: ChannelManager
  private logger = new Logger("notifier")

  // Notification rules
  private notifyOnSuccess = true
  private notifyOnFailure = true
  private notifyOnServerRestart = true

  constructor(channels: ChannelManager) {
    this.channels = channels
  }

  setNotifyOnSuccess(v: boolean): void { this.notifyOnSuccess = v }
  setNotifyOnFailure(v: boolean): void { this.notifyOnFailure = v }
  setNotifyOnServerRestart(v: boolean): void { this.notifyOnServerRestart = v }

  /**
   * Send a notification about task completion
   */
  async notifyTaskComplete(exec: TaskExecution, task: TaskDefinition): Promise<void> {
    const shouldNotify = exec.status === "completed" ? this.notifyOnSuccess : this.notifyOnFailure
    if (!shouldNotify) return

    const duration = exec.completedAt && exec.startedAt
      ? Math.round((new Date(exec.completedAt).getTime() - new Date(exec.startedAt).getTime()) / 1000)
      : 0

    const statusEmoji = exec.status === "completed" ? "✅" : exec.status === "failed" ? "❌" : "⚠️"
    const stepsSummary = exec.stepResults
      .map((s) => `  ${s.status === "success" ? "✅" : "❌"} ${s.stepId}: ${s.duration}ms`)
      .join("\n")

    const content = [
      `${statusEmoji} Task: ${task.name}`,
      `Status: ${exec.status}`,
      `Duration: ${duration}s`,
      ...(exec.error ? [`Error: ${exec.error.slice(0, 200)}`] : []),
      ``,
      `Steps:`,
      stepsSummary,
      ``,
      `ID: ${task.id}`,
    ].join("\n")

    await this.broadcast("pcbot", content)
  }

  /**
   * Send notification about server restart
   */
  async notifyServerRestart(attempt: number, maxAttempts: number, success: boolean): Promise<void> {
    if (!this.notifyOnServerRestart) return

    const content = success
      ? `🔄 Server auto-restart succeeded (attempt ${attempt}/${maxAttempts})`
      : `🔴 Server auto-restart FAILED (attempt ${attempt}/${maxAttempts})`

    await this.broadcast("pcbot", content)
  }

  /**
   * Send notification about health degradation
   */
  async notifyHealthIssue(issue: string): Promise<void> {
    await this.broadcast("pcbot", `⚠️ Health issue: ${issue}`)
  }

  /**
   * Send a daily summary
   */
  async sendDailySummary(tasksCompleted: number, tasksFailed: number, uptime: number): Promise<void> {
    const hours = Math.floor(uptime / 3600000)
    const content = [
      `📊 Daily Summary`,
      `─`.repeat(30),
      `Tasks Completed: ${tasksCompleted}`,
      `Tasks Failed: ${tasksFailed}`,
      `System Uptime: ${hours}h`,
      `Success Rate: ${tasksCompleted + tasksFailed > 0
        ? Math.round((tasksCompleted / (tasksCompleted + tasksFailed)) * 100)
        : 100}%`,
    ].join("\n")

    await this.broadcast("pcbot", content)
  }

  private async broadcast(from: string, content: string): Promise<void> {
    const msg: ChannelMessage = {
      id: ulid(),
      channel: "stdout",
      from,
      content,
      timestamp: new Date().toISOString(),
    }
    await this.channels.broadcast(msg).catch((err) => {
      this.logger.error(`Broadcast failed: ${(err as Error).message}`)
    })
  }
}

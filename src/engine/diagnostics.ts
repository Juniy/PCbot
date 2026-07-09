import { Logger } from "../monitor/logger"
import { OpenCodeClient } from "../client"
import { TaskStore } from "./store"
import type { TaskExecution, TaskDefinition } from "../types"

/**
 * AI Diagnostic Engine
 *
 * Uses OpenCode's AI agent to:
 * 1. Analyze task failures and suggest fixes
 * 2. Automatically fix recurring issues
 * 3. Provide detailed diagnostic reports
 */
export class DiagnosticEngine {
  private client: OpenCodeClient
  private store: TaskStore
  private logger = new Logger("diagnostic-engine")
  private enabled = false

  constructor(client: OpenCodeClient, store: TaskStore) {
    this.client = client
    this.store = store
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.logger.info(`AI diagnostics ${enabled ? "enabled" : "disabled"}`)
  }

  /**
   * Analyze a failed execution and return a diagnostic report
   */
  async analyzeFailure(exec: TaskExecution, task: TaskDefinition): Promise<DiagnosticReport> {
    const report: DiagnosticReport = {
      executionId: exec.id,
      taskId: task.id,
      taskName: task.name,
      failedStep: exec.stepResults[exec.stepResults.length - 1],
      analysis: "",
      suggestedFix: "",
      confidence: 0,
      autoFixApplied: false,
      timestamp: new Date().toISOString(),
    }

    if (!this.enabled || !this.client.isConfigured) {
      report.analysis = "AI diagnostics disabled or API not configured"
      report.confidence = 0
      return report
    }

    try {
      const failedStep = exec.stepResults.find((s) => s.status === "failed")
      const prompt = this.buildDiagnosticPrompt(exec, task, failedStep)

      const result = await this.client.v2CreateSession()
      const sessionId = result.data?.id ?? (result as any).id
      if (!sessionId) throw new Error("Failed to create diagnostic session")

      const response = await this.client.v2Prompt(sessionId, prompt)
      const text = typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? "")

      // Parse the AI response
      const parsed = this.parseDiagnosticResponse(text)
      report.analysis = parsed.analysis
      report.suggestedFix = parsed.suggestedFix
      report.confidence = parsed.confidence

      this.logger.info(
        `Diagnosis for "${task.name}": confidence=${parsed.confidence}, ` +
        `analysis=${parsed.analysis.slice(0, 100)}...`,
      )
    } catch (err) {
      this.logger.error(`Diagnostic analysis failed: ${(err as Error).message}`)
      report.analysis = `Diagnostic engine error: ${(err as Error).message}`
      report.confidence = 0
    }

    return report
  }

  /**
   * Automatically fix a failed task based on diagnostic analysis
   */
  async autoFix(task: TaskDefinition, report: DiagnosticReport): Promise<TaskDefinition | null> {
    if (!this.enabled || report.confidence < 0.5 || !report.suggestedFix) {
      return null
    }

    try {
      const prompt = [
        `Task "${task.name}" failed.`,
        `Error: ${report.failedStep?.error ?? "Unknown"}`,
        `Suggested fix: ${report.suggestedFix}`,
        ``,
        `Here is the task definition in JSON:`,
        JSON.stringify(task, null, 2),
        ``,
        `Please provide a corrected version of the task steps as a JSON array. `,
        `Only respond with valid JSON, no explanation.`,
      ].join("\n")

      const session = await this.client.v2CreateSession()
      const sessionId = session.data?.id ?? (session as any).id
      if (!sessionId) throw new Error("Failed to create fix session")

      const response = await this.client.v2Prompt(sessionId, prompt)
      const text = typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? "")

      // Try to extract JSON from response
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const newSteps = JSON.parse(jsonMatch[0])
        task.steps = newSteps
        task.updatedAt = new Date().toISOString()
        this.store.updateTask(task.id, { steps: newSteps, updatedAt: task.updatedAt })
        this.logger.info(`Auto-fix applied to task "${task.name}"`)
        return task
      }
    } catch (err) {
      this.logger.warn(`Auto-fix failed for "${task.name}": ${(err as Error).message}`)
    }

    return null
  }

  private buildDiagnosticPrompt(
    exec: TaskExecution,
    task: TaskDefinition,
    failedStep?: { stepId: string; status: string; error?: string },
  ): string {
    const steps = task.steps.map(
      (s) => `  ${s.id}: type=${s.type}, name="${s.name}", input="${s.input.slice(0, 100)}"`,
    ).join("\n")

    const results = exec.stepResults.map(
      (r) => `  step=${r.stepId}, status=${r.status}, error=${r.error ?? "none"}, duration=${r.duration}ms`,
    ).join("\n")

    return [
      `You are a diagnostic assistant. Analyze why this automated task failed.`,
      ``,
      `Task: "${task.name}"`,
      `Description: ${task.description ?? "N/A"}`,
      `Max Retries: ${task.maxRetries}`,
      `Timeout: ${task.timeout}ms`,
      ``,
      `Steps:`,
      steps,
      ``,
      `Execution Results:`,
      results,
      ``,
      `Task Status: ${exec.status}`,
      `Error: ${exec.error ?? "None"}`,
      ``,
      `Please provide:`,
      `1. ROOT_CAUSE: Brief root cause analysis (1-2 sentences)`,
      `2. SUGGESTED_FIX: Specific fix recommendation`,
      `3. CONFIDENCE: A number between 0 and 1 indicating your confidence`,
      ``,
      `Format your response exactly as:`,
      `ROOT_CAUSE: <text>`,
      `SUGGESTED_FIX: <text>`,
      `CONFIDENCE: <number>`,
    ].join("\n")
  }

  private parseDiagnosticResponse(text: string): {
    analysis: string
    suggestedFix: string
    confidence: number
  } {
    let analysis = ""
    let suggestedFix = ""
    let confidence = 0

    const rootCauseMatch = text.match(/ROOT_CAUSE:\s*(.+?)(?:\n|$)/i)
    if (rootCauseMatch?.[1]) analysis = rootCauseMatch[1].trim()

    const fixMatch = text.match(/SUGGESTED_FIX:\s*(.+?)(?:\n|$)/i)
    if (fixMatch?.[1]) suggestedFix = fixMatch[1].trim()

    const confMatch = text.match(/CONFIDENCE:\s*([0-9.]+)/i)
    if (confMatch?.[1]) confidence = Math.min(1, Math.max(0, parseFloat(confMatch[1])))

    // Fallback: use whole text if parsing failed
    if (!analysis && !suggestedFix) {
      analysis = text.slice(0, 500)
    }

    return { analysis, suggestedFix, confidence }
  }

  /**
   * Analyze all recent failures and return a summary
   */
  async analyzeRecentFailures(limit = 50): Promise<{
    total: number
    failures: number
    diagnoses: DiagnosticReport[]
  }> {
    const recent = this.store.getRecentExecutions(limit)
    const failed = recent.filter((e) => e.status === "failed")

    const diagnoses: DiagnosticReport[] = []
    for (const exec of failed) {
      const task = this.store.getTask(exec.taskId)
      if (task) {
        const report = await this.analyzeFailure(exec, task)
        diagnoses.push(report)
      }
    }

    return {
      total: recent.length,
      failures: failed.length,
      diagnoses,
    }
  }
}

export interface DiagnosticReport {
  executionId: string
  taskId: string
  taskName: string
  failedStep?: { stepId: string; status: string; error?: string }
  analysis: string
  suggestedFix: string
  confidence: number
  autoFixApplied: boolean
  timestamp: string
}

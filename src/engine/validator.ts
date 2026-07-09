import { Logger } from "../monitor/logger"
import { OpenCodeClient } from "../client"
import type { TaskExecution, TaskDefinition } from "../types"

export interface ValidationResult {
  passed: boolean
  score: number // 0-1
  issues: string[]
  suggestions: string[]
}

/**
 * AI Result Validator
 *
 * Uses OpenCode's AI to validate task execution results:
 * 1. Check if output meets the goal/requirements
 * 2. Identify quality issues
 * 3. Suggest improvements
 */
export class ResultValidator {
  private client: OpenCodeClient
  private logger = new Logger("result-validator")
  private enabled = false

  constructor(client: OpenCodeClient) {
    this.client = client
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.logger.info(`Result validation ${enabled ? "enabled" : "disabled"}`)
  }

  /**
   * Validate a completed task execution's result
   */
  async validate(exec: TaskExecution, task: TaskDefinition): Promise<ValidationResult> {
    const result: ValidationResult = {
      passed: true,
      score: 1.0,
      issues: [],
      suggestions: [],
    }

    if (!this.enabled || !this.client.isConfigured) {
      result.passed = exec.status === "completed"
      result.score = result.passed ? 1.0 : 0.0
      return result
    }

    try {
      // Collect output from successful steps
      const outputs = exec.stepResults
        .filter((s) => s.status === "success" && s.output)
        .map((s) => `Step ${s.stepId}: ${s.output!.slice(0, 500)}`)
        .join("\n\n")

      if (!outputs) {
        result.passed = exec.status === "completed"
        result.score = result.passed ? 1.0 : 0.0
        return result
      }

      const prompt = [
        `You are a quality assurance validator. Evaluate if this task execution was successful.`,
        ``,
        `Task: "${task.name}"`,
        `Description: ${task.description ?? "N/A"}`,
        `Status: ${exec.status}`,
        ``,
        `Outputs:`,
        outputs,
        ``,
        `Evaluate:`,
        `1. Does the output fulfill the task goal?`,
        `2. Are there any errors or quality issues?`,
        `3. What could be improved?`,
        ``,
        `Respond in this format:`,
        `PASSED: true/false`,
        `SCORE: 0.0-1.0`,
        `ISSUES: comma-separated list or "none"`,
        `SUGGESTIONS: comma-separated list or "none"`,
      ].join("\n")

      const session = await this.client.v2CreateSession()
      const sessionId = session.data?.id ?? (session as any).id
      if (!sessionId) throw new Error("Failed to create validation session")

      const response = await this.client.v2Prompt(sessionId, prompt)
      const text = typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? "")

      return this.parseValidation(text)
    } catch (err) {
      this.logger.warn(`Validation failed: ${(err as Error).message}`)
      result.passed = exec.status === "completed"
      result.score = result.passed ? 1.0 : 0.0
    }

    return result
  }

  private parseValidation(text: string): ValidationResult {
    const result: ValidationResult = {
      passed: true,
      score: 1.0,
      issues: [],
      suggestions: [],
    }

    const passedMatch = text.match(/PASSED:\s*(true|false)/i)
    if (passedMatch?.[1]) result.passed = passedMatch[1].toLowerCase() === "true"

    const scoreMatch = text.match(/SCORE:\s*([0-9.]+)/i)
    if (scoreMatch?.[1]) result.score = Math.min(1, Math.max(0, parseFloat(scoreMatch[1])))

    const issuesMatch = text.match(/ISSUES:\s*(.+?)(?:\n|$)/i)
    if (issuesMatch?.[1] && issuesMatch[1].toLowerCase() !== "none") {
      result.issues = issuesMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
    }

    const suggestionsMatch = text.match(/SUGGESTIONS:\s*(.+?)(?:\n|$)/i)
    if (suggestionsMatch?.[1] && suggestionsMatch[1].toLowerCase() !== "none") {
      result.suggestions = suggestionsMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
    }

    return result
  }
}

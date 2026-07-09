import { ulid } from "./ulid"
import { Logger } from "../monitor/logger"
import { OpenCodeClient } from "../client"
import { TaskStore } from "./store"
import { TaskExecutor } from "./executor"
import type { TaskDefinition, TaskStep } from "../types"

/**
 * AI Task Decomposer
 *
 * Uses OpenCode's AI to:
 * 1. Break complex task descriptions into executable step sequences
 * 2. Optimize step ordering
 * 3. Add validation steps automatically
 */
export class TaskDecomposer {
  private client: OpenCodeClient
  private store: TaskStore
  private executor: TaskExecutor
  private logger = new Logger("task-decomposer")
  private enabled = false

  constructor(client: OpenCodeClient, store: TaskStore, executor: TaskExecutor) {
    this.client = client
    this.store = store
    this.executor = executor
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.logger.info(`Task decomposition ${enabled ? "enabled" : "disabled"}`)
  }

  /**
   * Decompose a high-level goal into executable steps
   */
  async decompose(goal: string, context?: string): Promise<TaskDefinition> {
    const task: TaskDefinition = {
      id: ulid(),
      name: `Decomposed: ${goal.slice(0, 60)}`,
      description: goal,
      steps: [],
      maxRetries: 2,
      timeout: 300_000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: ["ai-decomposed"],
    }

    if (!this.enabled || !this.client.isConfigured) {
      // Fallback: create a single prompt step
      task.steps = [
        {
          id: ulid(),
          type: "prompt",
          name: "Execute Goal",
          input: goal,
          timeout: 120_000,
        },
      ]
      this.logger.info(`AI decomposition disabled, created single-step task for "${goal.slice(0, 50)}"`)
      this.store.addTask(task)
      return task
    }

    try {
      const prompt = this.buildDecompositionPrompt(goal, context)
      const session = await this.client.v2CreateSession()
      const sessionId = session.data?.id ?? (session as any).id
      if (!sessionId) throw new Error("Failed to create decomposition session")

      const response = await this.client.v2Prompt(sessionId, prompt)
      const text = typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? "")

      // Parse steps from AI response
      const steps = this.parseSteps(text, goal)
      task.steps = steps
      task.updatedAt = new Date().toISOString()

      this.logger.info(`Decomposed goal into ${steps.length} steps: ${steps.map((s) => s.name).join(" → ")}`)
    } catch (err) {
      this.logger.warn(`Decomposition failed: ${(err as Error).message}, using fallback`)
      task.steps = [
        {
          id: ulid(),
          type: "prompt",
          name: "Execute Goal",
          input: goal,
          timeout: 120_000,
        },
      ]
    }

    this.store.addTask(task)
    return task
  }

  /**
   * Decompose and immediately execute
   */
  async decomposeAndRun(goal: string, context?: string): Promise<TaskDefinition> {
    const task = await this.decompose(goal, context)

    // Execute in background
    this.executor.executeTask(task).catch((err) => {
      this.logger.error(`Decomposed task execution failed: ${(err as Error).message}`)
    })

    return task
  }

  private buildDecompositionPrompt(goal: string, context?: string): string {
    return [
      `You are a task decomposition expert. Break down the following goal into a sequence of executable steps.`,
      ``,
      `Goal: "${goal}"`,
      ...(context ? [`Context: ${context}`] : []),
      ``,
      `Rules:`,
      `1. Each step must be atomic and achievable`,
      `2. Steps should be ordered for maximum efficiency`,
      `3. Complex operations should be split into multiple steps`,
      `4. Each step must include a clear "input" that describes what to do`,
      `5. Use "prompt" type for AI reasoning steps`,
      `6. Use "shell_command" type for terminal commands`,
      `7. Use "file_operation" type for file operations`,
      ``,
      `Respond ONLY with a JSON array of steps in this exact format:`,
      `[`,
      `  { "type": "prompt", "name": "step name", "input": "detailed instruction" },`,
      `  { "type": "shell_command", "name": "step name", "input": "command to run" }`,
      `]`,
      ``,
      `Minimum 2 steps, maximum 8 steps. Only output the JSON array, nothing else.`,
    ].join("\n")
  }

  private parseSteps(text: string, goal: string): TaskStep[] {
    try {
      // Try to extract JSON array
      const jsonMatch = text.match(/\[[\s\S]*?\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((s: any, i: number) => ({
            id: `step-${i + 1}-${ulid().slice(0, 8)}`,
            type: s.type ?? "prompt",
            name: s.name ?? `Step ${i + 1}`,
            input: s.input ?? s.command ?? goal,
            timeout: s.timeout ?? 120_000,
            maxRetries: s.maxRetries ?? 1,
          }))
        }
      }
    } catch {
      // Fall through to fallback
    }

    // Fallback: single prompt step
    return [
      {
        id: `step-1-${ulid().slice(0, 8)}`,
        type: "prompt",
        name: "Execute Goal",
        input: goal,
        timeout: 120_000,
      },
    ]
  }
}

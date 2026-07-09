import { ulid } from "./ulid"
import { OpenCodeClient } from "../client"
import { Logger } from "../monitor/logger"
import { TaskStore } from "./store"
import type { TaskDefinition, TaskExecution, TaskStep, StepResult, TaskStatus, AgentID, StepType } from "../types"
import { getConfig } from "../config"

export type TaskEventCallback = (event: { type: "start" | "complete" | "fail"; exec: TaskExecution; task?: TaskDefinition }) => void

/**
 * Step type → OMO agent mapping
 * Selects the optimal agent from oh-my-openagent based on step purpose.
 * Map keys are step types; values are agent IDs from oh-my-openagent.json.
 */
const STEP_AGENT_MAP: Partial<Record<StepType, AgentID>> = {
  prompt: "sisyphus-junior",
  session_command: "sisyphus-junior",
  shell_command: "hephaestus",
  file_operation: "hephaestus",
  webhook: "build",
  condition: "build",
}

/** Higher-level task purpose → agent overrides (used by router/decomposer) */
export const TASK_AGENT_MAP: Record<string, AgentID> = {
  analyze: "explore",
  research: "explore",
  plan: "prometheus",
  design: "atlas",
  review: "momus",
  diagnose: "oracle",
  execute: "sisyphus-junior",
}

function pickAgent(task: TaskDefinition, step: TaskStep): string | undefined {
  // 1. Per-step override
  if (step.agentID) return step.agentID
  // 2. Task-level default
  if (task.agentID) return task.agentID
  // 3. Step type mapping
  const mapped = STEP_AGENT_MAP[step.type]
  if (mapped) return mapped
  // 4. Config default
  return getConfig().tasks.defaultAgent
}

export class TaskExecutor {
  private client: OpenCodeClient
  private store: TaskStore
  private logger = new Logger("task-executor")
  private runningTasks = new Set<string>()
  private abortController = new AbortController()
  private listeners: TaskEventCallback[] = []

  constructor(client: OpenCodeClient, store: TaskStore) {
    this.client = client
    this.store = store
  }

  onEvent(cb: TaskEventCallback): void {
    this.listeners.push(cb)
  }

  private emit(event: { type: "start" | "complete" | "fail"; exec: TaskExecution; task?: TaskDefinition }): void {
    for (const cb of this.listeners) {
      try { cb(event) } catch { /* ignore listener errors */ }
    }
  }

  get isRunning(): boolean {
    return this.runningTasks.size > 0
  }

  get runningCount(): number {
    return this.runningTasks.size
  }

  async executeTask(task: TaskDefinition): Promise<TaskExecution> {
    const execId = ulid()
    const execution: TaskExecution = {
      id: execId,
      taskId: task.id,
      status: "running",
      startedAt: new Date().toISOString(),
      currentStep: 0,
      stepResults: [],
      retryCount: 0,
    }

    this.store.addExecution(execution)
    this.runningTasks.add(execId)
    this.emit({ type: "start", exec: execution, task })
    this.logger.info(`Starting task "${task.name}" (exec=${execId}, steps=${task.steps.length})`)

    try {
      for (let i = 0; i < task.steps.length; i++) {
        if (this.abortController.signal.aborted) {
          execution.status = "cancelled"
          break
        }

        const step = task.steps[i]!
        execution.currentStep = i
        this.store.updateExecution(execId, { currentStep: i })

        const result = await this.executeStep(step, task)
        execution.stepResults.push(result)

        if (result.status === "failed") {
          execution.status = "failed"
          execution.error = `Step "${step.name}" failed: ${result.error}`
          this.logger.error(`Task "${task.name}" failed at step "${step.name}": ${result.error}`)
          break
        }
      }

      if (execution.status === "running") {
        execution.status = "completed"
        this.logger.info(`Task "${task.name}" completed successfully`)
      }
    } catch (err) {
      execution.status = "failed"
      execution.error = (err as Error).message
      this.logger.error(`Task "${task.name}": ${(err as Error).message}`)
    } finally {
      execution.completedAt = new Date().toISOString()
      this.store.updateExecution(execId, {
        status: execution.status,
        completedAt: execution.completedAt,
        error: execution.error,
        stepResults: execution.stepResults,
      })
      this.emit({
        type: execution.status === "completed" ? "complete" : "fail",
        exec: execution,
        task,
      })
      this.runningTasks.delete(execId)
    }

    return execution
  }

  private async executeStep(step: TaskStep, task: TaskDefinition): Promise<StepResult> {
    const startTime = Date.now()
    const result: StepResult = {
      stepId: step.id,
      status: "success",
      startedAt: new Date().toISOString(),
      duration: 0,
    }

    const maxRetries = step.maxRetries ?? task.maxRetries

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const timeout = step.timeout ?? task.timeout
        const output = await this.runStepAction(step, task, timeout)

        result.output = output
        result.duration = Date.now() - startTime

        // Validate expected match if specified
        if (step.expectedMatch && output) {
          const match = output.includes(step.expectedMatch)
          if (!match) {
            throw new Error(`Output does not contain expected text: "${step.expectedMatch}"`)
          }
        }

        result.status = "success"
        break
      } catch (err) {
        const isLast = attempt === maxRetries
        result.error = (err as Error).message

        if (!isLast) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10_000)
          this.logger.warn(`Step "${step.name}" attempt ${attempt + 1} failed, retrying in ${delay}ms: ${result.error}`)
          await new Promise((r) => setTimeout(r, delay))
        } else {
          result.status = "failed"
          result.duration = Date.now() - startTime
          this.logger.error(`Step "${step.name}": ${result.error}`)
        }
      }
    }

    result.completedAt = new Date().toISOString()
    return result
  }

  private async runStepAction(step: TaskStep, task: TaskDefinition, timeout: number): Promise<string> {
    const ac = new AbortController()
    const timeoutId = setTimeout(() => ac.abort(), timeout)

    try {
      const agentId = pickAgent(task, step)

      switch (step.type) {
        case "prompt": {
          // Create a temp session and prompt
          const session = await this.client.v2CreateSession({ agentID: agentId })
          const sessionId = session.data.id
          if (!sessionId) throw new Error("Failed to create session (no id returned)")

          const result = await this.client.v2Prompt(sessionId, step.input)
          const text = typeof result.data === "string" ? result.data : JSON.stringify(result.data)
          return text
        }

        case "session_command": {
          // Execute within a session
          const session = await this.client.v2CreateSession({ agentID: agentId })
          const sessionId = session.data.id
          if (!sessionId) throw new Error("Failed to create session")

          const result = await this.client.v2Prompt(sessionId, step.input)
          return typeof result.data === "string" ? result.data : JSON.stringify(result.data)
        }

        case "shell_command": {
          // Execute via PTY if available, fallback to local exec
          const { execSync } = await import("child_process")
          try {
            const output = execSync(step.input, {
              timeout: timeout - 1000,
              encoding: "utf-8",
              maxBuffer: 10 * 1024 * 1024,
            })
            return output ?? ""
          } catch (err) {
            const e = err as { stdout?: Buffer | string }
            if (e.stdout) return e.stdout.toString()
            throw err
          }
        }

        case "file_operation": {
          const { readFileSync, writeFileSync, existsSync } = await import("fs")
          if (step.filePath) {
            if (step.fileContent !== undefined) {
              writeFileSync(step.filePath, step.fileContent, "utf-8")
              return `Written ${step.fileContent.length} bytes to ${step.filePath}`
            } else {
              const content = readFileSync(step.filePath, "utf-8")
              return content
            }
          }
          throw new Error("filePath is required for file_operation step")
        }

        case "webhook": {
          const response = await fetch(step.input, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
            signal: ac.signal,
          })
          return await response.text()
        }

        case "condition": {
          // Simple condition: if input is "true" or "1", success
          const condResult = step.input.toLowerCase().trim()
          if (condResult === "true" || condResult === "1" || condResult === "yes") {
            return "condition passed"
          }
          throw new Error(`Condition not met: "${step.input}"`)
        }

        default:
          throw new Error(`Unknown step type: ${step.type}`)
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  cancelTask(execId: string): boolean {
    const exec = this.store.getExecution(execId)
    if (!exec || exec.status !== "running") return false

    exec.status = "cancelled"
    exec.completedAt = new Date().toISOString()
    this.store.updateExecution(execId, { status: "cancelled", completedAt: exec.completedAt })
    this.runningTasks.delete(execId)
    return true
  }

  cancelAll(): void {
    this.abortController.abort()
    for (const id of this.runningTasks) {
      const exec = this.store.getExecution(id)
      if (exec) {
        exec.status = "cancelled"
        exec.completedAt = new Date().toISOString()
        this.store.updateExecution(id, { status: "cancelled", completedAt: exec.completedAt })
      }
    }
    this.runningTasks.clear()
  }

  dispose(): void {
    this.cancelAll()
  }
}

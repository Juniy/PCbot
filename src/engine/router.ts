import { ulid } from "./ulid"
import { Logger } from "../monitor/logger"
import { TaskStore } from "./store"
import { TaskExecutor } from "./executor"
import { ChannelManager } from "../channels"
import type { ChannelMessage, TaskDefinition, TaskStep } from "../types"

/**
 * Task Router: connects Channel messages → Task execution
 */
export class TaskRouter {
  private store: TaskStore
  private executor: TaskExecutor
  private channels: ChannelManager
  private logger = new Logger("task-router")

  // Predefined task templates
  private templates: Map<string, (msg: ChannelMessage) => TaskDefinition> = new Map()

  constructor(store: TaskStore, executor: TaskExecutor, channels: ChannelManager) {
    this.store = store
    this.executor = executor
    this.channels = channels

    this.registerDefaultTemplates()
  }

  private registerDefaultTemplates(): void {
    // Template: simple prompt → run AI agent
    this.templates.set("prompt", (msg) => ({
      id: ulid(),
      name: `AI Response: ${msg.content.slice(0, 40)}`,
      steps: [
        {
          id: "prompt-1",
          type: "prompt",
          name: "AI Response",
          input: msg.content,
          timeout: 120_000,
        },
      ],
      maxRetries: 2,
      timeout: 180_000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))

    // Template: shell command
    this.templates.set("shell", (msg) => ({
      id: ulid(),
      name: `Shell: ${msg.content.slice(0, 40)}`,
      steps: [
        {
          id: "shell-1",
          type: "shell_command",
          name: "Execute Command",
          input: msg.content,
          timeout: 60_000,
        },
      ],
      maxRetries: 1,
      timeout: 120_000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))

    // Template: multi-step analysis
    this.templates.set("analyze", (msg) => ({
      id: ulid(),
      name: `Analysis: ${msg.content.slice(0, 40)}`,
      steps: [
        {
          id: "plan-1",
          type: "prompt",
          name: "Create Plan",
          input: `Create an analysis plan for: ${msg.content}`,
          timeout: 60_000,
        },
        {
          id: "execute-1",
          type: "prompt",
          name: "Execute Analysis",
          input: `Now execute the analysis plan for: ${msg.content}. Provide detailed results.`,
          timeout: 180_000,
        },
        {
          id: "summarize-1",
          type: "prompt",
          name: "Summarize",
          input: `Summarize the analysis results for: ${msg.content}`,
          timeout: 60_000,
        },
      ],
      maxRetries: 2,
      timeout: 300_000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))
  }

  /**
   * Route an incoming channel message to task execution
   */
  async route(msg: ChannelMessage): Promise<string | null> {
    this.logger.info(`Routing message from ${msg.channel}:${msg.from}: "${msg.content.slice(0, 60)}"`)

    // Detect intent from message content
    const template = this.detectTemplate(msg)

    if (!template) {
      this.logger.debug(`No matching template for message, skipping`)
      return null
    }

    const task = template(msg)
    this.store.addTask(task)

    // Execute asynchronously
    this.executor.executeTask(task).then(async (exec) => {
      this.logger.info(`Task "${task.name}" completed: ${exec.status}`)

      // Send result back to channel
      const lastStep = exec.stepResults[exec.stepResults.length - 1]
      const resultMsg: ChannelMessage = {
        id: ulid(),
        channel: msg.channel,
        from: "pcbot",
        content: `[${exec.status}] ${task.name}\n${exec.error ?? lastStep?.output?.slice(0, 500) ?? "Done"}`,
        timestamp: new Date().toISOString(),
      }
      await this.channels.sendTo(msg.channel, resultMsg).catch(() => {})
    })

    return task.id
  }

  /**
   * Detect which task template to use based on message content
   */
  private detectTemplate(msg: ChannelMessage): ((msg: ChannelMessage) => TaskDefinition) | undefined {
    const content = msg.content.toLowerCase().trim()

    // Shell command prefix
    if (content.startsWith("!") || content.startsWith("$ ")) {
      return this.templates.get("shell")
    }

    // Analysis prefix
    if (
      content.startsWith("analyze") ||
      content.startsWith("分析") ||
      content.startsWith("research") ||
      content.startsWith("研究")
    ) {
      return this.templates.get("analyze")
    }

    // Default to prompt
    return this.templates.get("prompt")
  }

  /**
   * Add a custom template
   */
  addTemplate(name: string, builder: (msg: ChannelMessage) => TaskDefinition): void {
    this.templates.set(name, builder)
    this.logger.info(`Task template registered: ${name}`)
  }
}

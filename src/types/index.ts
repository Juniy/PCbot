import type { z } from "zod"

// ===== 任务系统类型 =====

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled"

export type StepType = "prompt" | "session_command" | "file_operation" | "shell_command" | "webhook" | "condition"

export interface TaskStep {
  id: string
  type: StepType
  name: string
  /** prompt / command content */
  input: string
  /** Expected output match (optional validation) */
  expectedMatch?: string
  /** Timeout in ms */
  timeout?: number
  /** Max retries for this step */
  maxRetries?: number
  /** Condition to skip/run this step */
  condition?: string
  /** File operation specific */
  filePath?: string
  fileContent?: string
}

export interface TaskDefinition {
  id: string
  name: string
  description?: string
  steps: TaskStep[]
  /** cron expression for scheduled execution */
  schedule?: string
  maxRetries: number
  timeout: number
  createdAt: string
  updatedAt: string
  tags?: string[]
}

export interface TaskExecution {
  id: string
  taskId: string
  status: TaskStatus
  startedAt: string
  completedAt?: string
  error?: string
  currentStep: number
  stepResults: StepResult[]
  retryCount: number
}

export interface StepResult {
  stepId: string
  status: "success" | "failed" | "skipped"
  output?: string
  error?: string
  startedAt: string
  completedAt?: string
  duration: number
}

// ===== 渠道系统类型 =====

export type ChannelType = "wechat" | "webhook" | "http" | "stdout"

export interface ChannelMessage {
  id: string
  channel: ChannelType
  from: string
  content: string
  timestamp: string
}

export interface ChannelAdapter {
  type: ChannelType
  name: string
  send(msg: ChannelMessage): Promise<void>
  receive?(handler: (msg: ChannelMessage) => void): void
  start(): Promise<void>
  stop(): Promise<void>
}

// ===== 监控类型 =====

export interface HealthStatus {
  serverRunning: boolean
  apiReachable: boolean
  lastCheck: string
  uptime: number
  responseTime: number
  memoryMB: number
  errorCount: number
}

export interface AlertRule {
  name: string
  condition: (status: HealthStatus) => boolean
  severity: "info" | "warn" | "error" | "critical"
  message: string
}

// ===== 配置类型 =====

export interface AppConfig {
  server: {
    hostname: string
    port: number
    logLevel: "debug" | "info" | "warn" | "error"
    opencodeBinary: string
    autoRestart: boolean
    maxRestarts: number
  }
  monitor: {
    intervalMs: number
    restartBackoffMs: number[]
    logDir: string
    logMaxSize: number
  }
  channels: {
    wechat?: {
      enabled: boolean
    }
    webhook?: {
      enabled: boolean
      port: number
    }
  }
  tasks: {
    storePath: string
    maxHistory: number
    defaultTimeout: number
  }
}

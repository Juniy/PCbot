import { getConfig } from "../config"
import * as fs from "fs"
import * as path from "path"

export type LogLevel = "debug" | "info" | "warn" | "error"

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// ===== Global Log Buffer (for real-time streaming) =====
export interface LogEntry {
  time: string
  level: LogLevel
  logger: string
  msg: string
  _raw: string // JSON string for SSE
}

const MAX_BUFFER = 1000
const logBuffer: LogEntry[] = []
const sseClients: Set<(entry: LogEntry) => void> = new Set()

export function subscribeLogs(cb: (entry: LogEntry) => void): () => void {
  sseClients.add(cb)
  return () => { sseClients.delete(cb) }
}

export function getRecentLogs(limit = 200): LogEntry[] {
  return logBuffer.slice(-limit)
}

function pushLog(entry: LogEntry): void {
  logBuffer.push(entry)
  if (logBuffer.length > MAX_BUFFER) logBuffer.shift()
  for (const cb of sseClients) {
    try { cb(entry) } catch { /* ignore */ }
  }
}

export class Logger {
  private name: string
  private logDir: string

  constructor(name: string) {
    this.name = name
    this.logDir = getConfig().monitor.logDir
    this.ensureLogDir()
  }

  private ensureLogDir(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true })
      }
    } catch {
      // silently fail
    }
  }

  private formatMessage(level: LogLevel, message: string): string {
    return JSON.stringify({
      time: new Date().toISOString(),
      level,
      logger: this.name,
      msg: message,
    })
  }

  private shouldLog(level: LogLevel): boolean {
    const configLevel = getConfig().server.logLevel
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[configLevel]
  }

  private write(level: LogLevel, message: string): void {
    if (!this.shouldLog(level)) return

    const formatted = this.formatMessage(level, message)

    // Push to global log buffer (for SSE streaming)
    const entry: LogEntry = {
      time: new Date().toISOString(),
      level,
      logger: this.name,
      msg: message,
      _raw: formatted,
    }
    pushLog(entry)

    // Console output (use _raw for consistent format)
    switch (level) {
      case "error":
        console.error(entry._raw)
        break
      case "warn":
        console.warn(entry._raw)
        break
      default:
        console.log(entry._raw)
    }

    // File output
    this.writeToFile(formatted)
  }

  private writeToFile(formatted: string): void {
    try {
      const logFile = path.join(this.logDir, `pcbot-${new Date().toISOString().slice(0, 10)}.log`)
      fs.appendFileSync(logFile, formatted + "\n")

      // Rotate if too large
      const maxSize = getConfig().monitor.logMaxSize
      const stat = fs.statSync(logFile)
      if (stat.size > maxSize) {
        this.rotateLog(logFile)
      }
    } catch {
      // silently fail for logging
    }
  }

  private rotateLog(filePath: string): void {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      const rotated = filePath.replace(/\.log$/, `-${timestamp}.log`)
      fs.renameSync(filePath, rotated)
      // Enforce max log file count
      this.cleanOldLogs()
    } catch {
      // silently fail
    }
  }

  /** Remove oldest log files exceeding maxFiles limit */
  private cleanOldLogs(): void {
    try {
      const maxFiles = getConfig().monitor.logMaxFiles
      if (maxFiles <= 0) return
      const files = fs.readdirSync(this.logDir)
        .filter((f) => f.startsWith("pcbot-") && f.endsWith(".log"))
        .sort()
        .slice(0, -maxFiles) // keep newest N
      for (const f of files) {
        try { fs.unlinkSync(path.join(this.logDir, f)) } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  debug(message: string): void {
    this.write("debug", message)
  }

  info(message: string): void {
    this.write("info", message)
  }

  warn(message: string): void {
    this.write("warn", message)
  }

  error(message: string): void {
    this.write("error", message)
  }
}



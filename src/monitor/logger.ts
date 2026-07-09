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

    // Console output
    switch (level) {
      case "error":
        console.error(formatted)
        break
      case "warn":
        console.warn(formatted)
        break
      default:
        console.log(formatted)
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
    } catch {
      // silently fail
    }
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

// Global error logger
export const globalLogger = new Logger("system")

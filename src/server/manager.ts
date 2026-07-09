import { spawn, type ChildProcess } from "child_process"
import { getConfig } from "../config"
import { Logger } from "../monitor/logger"

export interface ServerEvents {
  onStdout?: (line: string) => void
  onStderr?: (line: string) => void
  onExit?: (code: number | null, signal: string | null) => void
  onError?: (error: Error) => void
  onListening?: (url: string) => void
}

export class ServerManager {
  private proc: ChildProcess | null = null
  private url: string | null = null
  private startedAt: number = 0
  private events: ServerEvents = {}
  private logger = new Logger("server-manager")
  private listeningRegex = /opencode server listening on\s+(https?:\/\/[^\s]+)/
  private abortController = new AbortController()

  constructor(events?: ServerEvents) {
    if (events) this.events = events
  }

  get isRunning(): boolean {
    return this.proc !== null && this.proc.exitCode === null
  }

  get serverUrl(): string | null {
    return this.url
  }

  get uptime(): number {
    if (!this.startedAt || !this.isRunning) return 0
    return Date.now() - this.startedAt
  }

  async start(): Promise<string> {
    if (this.isRunning) {
      this.logger.warn("Server already running")
      return this.url!
    }

    const config = getConfig().server
    this.url = null
    this.startedAt = 0

    return new Promise<string>((resolve, reject) => {
      const args = [
        "serve",
        `--hostname=${config.hostname}`,
        `--port=${config.port}`,
      ]
      if (config.logLevel !== "info") {
        args.push(`--log-level=${config.logLevel}`)
      }

      this.logger.info(`Starting opencode: opencode ${args.join(" ")}`)

      const proc = spawn(config.opencodeBinary, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
        signal: this.abortController.signal,
      })
      this.proc = proc
      this.startedAt = Date.now()

      let output = ""

      proc.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString()
        output += text
        this.events.onStdout?.(text)

        // Check for listening signal
        const match = output.match(this.listeningRegex)
        if (match && match[1]) {
          this.url = match[1]
          this.logger.info(`Server listening on ${this.url}`)
          this.events.onListening?.(this.url)
          resolve(this.url)
        }
      })

      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString()
        output += text
        this.events.onStderr?.(text)
        // Sometimes listening msg goes to stderr
        const match = output.match(this.listeningRegex)
        if (match && match[1]) {
          this.url = match[1]
          this.logger.info(`Server listening on ${this.url}`)
          this.events.onListening?.(this.url)
          resolve(this.url)
        }
      })

      proc.on("error", (err: Error) => {
        this.logger.error(`Server process error: ${err.message}`)
        this.proc = null
        this.events.onError?.(err)
        reject(err)
      })

      proc.on("exit", (code, signal) => {
        const wasRunning = this.isRunning
        this.proc = null
        this.url = null
        this.logger.info(`Server exited (code=${code}, signal=${signal})`)
        this.events.onExit?.(code, signal)

        // If we haven't resolved yet, reject
        if (!wasRunning && !output.match(this.listeningRegex)) {
          reject(new Error(`Server exited with code ${code} before listening.\nOutput: ${output}`))
        }
      })

      // Timeout: if no listening signal within 30s, fail
      const timeout = setTimeout(() => {
        if (this.url === null) {
          this.stop()
          reject(new Error(`Server failed to start within 30s.\nOutput: ${output}`))
        }
      }, 30_000)

      // Clear timeout on resolve/reject
      const origResolve = resolve
      const origReject = reject
      const wrapperReject = (err: Error) => {
        clearTimeout(timeout)
        origReject(err)
      }
      // Can't easily replace, but reject will be called before timeout
    })
  }

  async stop(): Promise<void> {
    if (!this.proc) return

    this.logger.info("Stopping server...")

    return new Promise<void>((resolve) => {
      const proc = this.proc!
      const forceKillTimeout = setTimeout(() => {
        this.logger.warn("Force killing server")
        proc.kill("SIGKILL")
      }, 10_000)

      proc.on("exit", () => {
        clearTimeout(forceKillTimeout)
        this.proc = null
        this.url = null
        resolve()
      })

      // Try graceful shutdown
      proc.kill("SIGTERM")
    })
  }

  async restart(): Promise<string> {
    await this.stop()
    return this.start()
  }

  async healthCheck(): Promise<{ ok: boolean; responseTime: number }> {
    if (!this.url) return { ok: false, responseTime: 0 }

    const start = Date.now()
    try {
      const response = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(5000) })
      const responseTime = Date.now() - start
      return { ok: response.ok, responseTime }
    } catch {
      return { ok: false, responseTime: Date.now() - start }
    }
  }

  dispose(): void {
    this.abortController.abort()
    this.stop()
  }
}

import * as http from "http"
import { Logger } from "../monitor/logger"
import type { ChannelAdapter, ChannelMessage, ChannelType } from "../types"
import { ulid } from "../engine/ulid"

export class WebhookChannel implements ChannelAdapter {
  type: ChannelType = "webhook"
  name = "webhook"
  private server: http.Server | null = null
  private logger = new Logger("webhook-channel")
  private messageHandler?: (msg: ChannelMessage) => void
  private port: number

  constructor(port = 8080) {
    this.port = port
  }

  onMessage(handler: (msg: ChannelMessage) => void): void {
    this.messageHandler = handler
  }

  async start(): Promise<void> {
    if (this.server) return

    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        // CORS
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        res.setHeader("Access-Control-Allow-Headers", "Content-Type")

        if (req.method === "OPTIONS") {
          res.writeHead(204)
          res.end()
          return
        }

        if (req.method === "POST" && req.url === "/webhook") {
          let body = ""
          req.on("data", (chunk) => (body += chunk))
          req.on("end", () => {
            try {
              const data = JSON.parse(body)
              const msg: ChannelMessage = {
                id: ulid(),
                channel: "webhook",
                from: data.from ?? "webhook",
                content: data.content ?? data.text ?? body,
                timestamp: new Date().toISOString(),
              }
              this.messageHandler?.(msg)
              res.writeHead(200, { "Content-Type": "application/json" })
              res.end(JSON.stringify({ ok: true, id: msg.id }))
            } catch {
              res.writeHead(400, { "Content-Type": "application/json" })
              res.end(JSON.stringify({ error: "invalid JSON" }))
            }
          })
          return
        }

        // Health endpoint
        if (req.url === "/health" || req.url === "/") {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ status: "ok", channel: "webhook" }))
          return
        }

        res.writeHead(404)
        res.end()
      })

      this.server.listen(this.port, "127.0.0.1", () => {
        this.logger.info(`Webhook channel listening on http://127.0.0.1:${this.port}/webhook`)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve()
        return
      }
      this.server.close(() => {
        this.server = null
        resolve()
      })
    })
  }

  async send(msg: ChannelMessage): Promise<void> {
    // Webhook channel is incoming-only for now
    this.logger.debug(`Webhook received message from ${msg.from}: ${msg.content.slice(0, 100)}`)
  }
}

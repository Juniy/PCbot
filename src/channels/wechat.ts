import { Logger } from "../monitor/logger"
import type { ChannelAdapter, ChannelMessage, ChannelType } from "../types"
import { ulid } from "../engine/ulid"
import * as http from "http"

export type WeChatMode = "webhook" | "proxy" | "work-wechat"

/**
 * WeChat Channel Adapter
 *
 * 微信集成说明：
 * 由于微信官方对个人/非认证号的 API 限制，本适配器使用多种模式：
 *
 * Mode 1 - Webhook 模式（推荐）：
 *   通过第三方微信网关（如 wechat-bot、wechaty、ComWeChatRobot 等）转发消息。
 *   微信网关收到消息后 POST 到本服务的 /api/channels/wechat 端点。
 *
 * Mode 2 - Proxy 模式：
 *   直接连接第三方网关的 REST API 进行消息收发。
 *
 * Mode 3 - 企业微信/公众号 Webhook：
 *   企业微信或微信公众平台的开发者 API。
 */
export class WeChatChannel implements ChannelAdapter {
  type: ChannelType = "wechat"
  name = "wechat"
  private logger = new Logger("wechat-channel")
  private messageHandler?: (msg: ChannelMessage) => void
  private server: http.Server | null = null
  private isRunning = false
  private mode: WeChatMode = "webhook"
  private gatewayUrl?: string
  private gatewayToken?: string
  private callbackUrl?: string

  constructor(options?: {
    mode?: WeChatMode
    gatewayUrl?: string
    gatewayToken?: string
    callbackUrl?: string
  }) {
    this.mode = options?.mode ?? "webhook"
    this.gatewayUrl = options?.gatewayUrl
    this.gatewayToken = options?.gatewayToken
    this.callbackUrl = options?.callbackUrl
  }

  onMessage(handler: (msg: ChannelMessage) => void): void {
    this.messageHandler = handler
  }

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    this.logger.info(`WeChat channel ready (mode: ${this.mode})`)

    if (this.gatewayUrl) {
      this.logger.info(`Gateway configured: ${this.gatewayUrl}`)
      if (this.mode === "proxy") {
        await this.registerWebhook()
      }
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false
    this.logger.info("WeChat channel stopped")
  }

  /**
   * Register outbound webhook callback with the gateway
   */
  private async registerWebhook(): Promise<void> {
    if (!this.gatewayUrl || !this.callbackUrl) return
    try {
      const payload: Record<string, unknown> = {
        callback_url: this.callbackUrl,
        events: ["message", "event"],
      }
      if (this.gatewayToken) {
        payload.token = this.gatewayToken
      }
      const response = await fetch(`${this.gatewayUrl}/webhook/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (response.ok) {
        this.logger.info("Gateway webhook registered successfully")
      } else {
        this.logger.warn(`Gateway webhook registration returned ${response.status}`)
      }
    } catch (err) {
      this.logger.warn(`Gateway webhook registration failed: ${(err as Error).message}`)
    }
  }

  /**
   * Send a message back to a WeChat user/group
   * Routes through the appropriate gateway based on mode
   */
  async send(msg: ChannelMessage): Promise<void> {
    if (this.gatewayUrl) {
      await this.sendViaGateway(msg)
    } else {
      this.logger.info(`[WeChat Out] To: ${msg.from} | ${msg.content.slice(0, 100)}`)
    }
  }

  private async sendViaGateway(msg: ChannelMessage): Promise<void> {
    if (!this.gatewayUrl) {
      this.logger.warn("Cannot send: no gateway URL configured")
      return
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (this.gatewayToken) {
      headers["Authorization"] = `Bearer ${this.gatewayToken}`
    }

    const payload: Record<string, unknown> = {
      to: msg.from,
      content: msg.content,
      type: "text",
    }

    try {
      const response = await fetch(this.gatewayUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        this.logger.error(`WeChat API error: ${response.status} ${await response.text()}`)
      }
    } catch (err) {
      this.logger.error(`WeChat send failed: ${(err as Error).message}`)
    }
  }

  /**
   * Handle an incoming webhook event from WeChat gateway
   * Supports multiple gateway payload formats
   */
  handleWebhook(body: any): { ok: boolean; id?: string } {
    // Support multiple gateway formats
    const content = body.content ?? body.text ?? body.message ?? body.Content ?? ""
    const from = body.from ?? body.sender ?? body.user ?? body.FromUserName ?? "unknown"

    if (!content) {
      return { ok: false }
    }

    const msg: ChannelMessage = {
      id: ulid(),
      channel: "wechat",
      from,
      content: typeof content === "string" ? content : JSON.stringify(content),
      timestamp: new Date().toISOString(),
    }

    this.messageHandler?.(msg)
    return { ok: true, id: msg.id }
  }
}

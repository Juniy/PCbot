import { Logger } from "../monitor/logger"
import type { ChannelAdapter, ChannelMessage, ChannelType } from "../types"
import { ulid } from "../engine/ulid"
import * as http from "http"

/**
 * WeChat Channel Adapter
 *
 * 微信集成说明：
 * 由于微信官方对个人/非认证号的 API 限制，本适配器使用两种模式：
 *
 * Mode 1 - Webhook 模式（推荐）：
 *   通过第三方微信网关（如 wechat-bot、wechaty、ComWeChatRobot 等）转发消息。
 *   微信网关收到消息后 POST 到本服务的 /api/channels/wechat 端点。
 *
 * Mode 2 - 企业微信/公众号 Webhook：
 *   企业微信或微信公众平台的开发者 API。
 *
 * 配置方式：
 *   PCbot 启动 HTTP 服务，微信网关配置回调 URL 为：
 *   http://your-host:8080/api/channels/wechat
 */
export class WeChatChannel implements ChannelAdapter {
  type: ChannelType = "wechat"
  name = "wechat"
  private logger = new Logger("wechat-channel")
  private messageHandler?: (msg: ChannelMessage) => void
  private server: http.Server | null = null
  private isRunning = false
  private wechatApiUrl?: string
  private wechatToken?: string

  constructor(options?: { apiUrl?: string; token?: string }) {
    this.wechatApiUrl = options?.apiUrl
    this.wechatToken = options?.token
  }

  onMessage(handler: (msg: ChannelMessage) => void): void {
    this.messageHandler = handler
  }

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    this.logger.info("WeChat channel ready")

    // If we have a direct WeChat API URL, test connection
    if (this.wechatApiUrl) {
      this.logger.info(`WeChat API configured: ${this.wechatApiUrl}`)
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false
    this.logger.info("WeChat channel stopped")
  }

  /**
   * Send a message back to a WeChat user/group
   * In webhook mode, this calls the WeChat gateway's API
   */
  async send(msg: ChannelMessage): Promise<void> {
    if (this.wechatApiUrl && this.wechatToken) {
      try {
        const response = await fetch(this.wechatApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.wechatToken}`,
          },
          body: JSON.stringify({
            to: msg.from,
            content: msg.content,
            type: "text",
          }),
        })
        if (!response.ok) {
          this.logger.error(`WeChat API error: ${response.status} ${await response.text()}`)
        }
      } catch (err) {
        this.logger.error(`WeChat send failed: ${(err as Error).message}`)
      }
    } else {
      this.logger.info(`[WeChat Out] To: ${msg.from} | ${msg.content.slice(0, 100)}`)
    }
  }

  /**
   * Handle an incoming webhook event from WeChat gateway
   */
  handleWebhook(body: any): { ok: boolean; id?: string } {
    const content = body.content ?? body.text ?? body.message ?? ""
    const from = body.from ?? body.sender ?? body.user ?? "unknown"

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

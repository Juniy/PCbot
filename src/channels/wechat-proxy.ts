/**
 * WeChat Gateway Proxy Adapter
 *
 * 微信消息代理 — 对接第三方微信网关接口。
 * 支持常见的微信个人号/企业号网关协议。
 *
 * 支持的网关：
 * - wechaty (https://wechaty.js.org)
 * - ComWeChatRobot (https://github.com/JustUndefined/ComWeChatRobot)
 * - wechat-bot (https://github.com/cixingguangming55555/wechat-bot)
 * - 企业微信机器人 Webhook
 *
 * 配置示例（config.yaml / opencode.jsonc）:
 * ```json
 * {
 *   "channels": {
 *     "wechat": {
 *       "enabled": true,
 *       "mode": "webhook",
 *       "gatewayUrl": "http://localhost:9090",
 *       "gatewayToken": "your-token",
 *       "callbackUrl": "http://localhost:8080/api/channels/wechat"
 *     }
 *   }
 * }
 * ```
 */
// WeChat通道已在 wechat.ts 中完整实现。
// 此文件作为配置参考和扩展入口。
export const WECHAT_GATEWAYS = {
  wechaty: {
    sendUrl: "/message/send",
    format: "puppet",
  },
  comWeChatRobot: {
    sendUrl: "/api/send",
    format: "json",
  },
  wechatBot: {
    sendUrl: "/webhook/send",
    format: "text",
  },
  workWechat: {
    sendUrl: "/cgi-bin/webhook/send",
    format: "markdown",
  },
} as const

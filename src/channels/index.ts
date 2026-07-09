import { Logger } from "../monitor/logger"
import type { ChannelAdapter, ChannelMessage, ChannelType } from "../types"
import { StdoutChannel } from "./stdout"
import { WebhookChannel } from "./webhook"

export class ChannelManager {
  private adapters: Map<ChannelType, ChannelAdapter> = new Map()
  private logger = new Logger("channel-manager")
  private messageHandlers: Array<(msg: ChannelMessage) => void> = []

  constructor() {
    this.register("stdout", new StdoutChannel())
  }

  register(type: ChannelType, adapter: ChannelAdapter): void {
    this.adapters.set(type, adapter)
    this.logger.info(`Channel adapter registered: ${type}`)
  }

  onMessage(handler: (msg: ChannelMessage) => void): void {
    this.messageHandlers.push(handler)
  }

  async startAll(): Promise<void> {
    for (const [type, adapter] of this.adapters) {
      try {
        await adapter.start()
        this.logger.info(`Channel "${type}" started`)
      } catch (err) {
        this.logger.error(`Failed to start channel "${type}": ${(err as Error).message}`)
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const [type, adapter] of this.adapters) {
      try {
        await adapter.stop()
        this.logger.info(`Channel "${type}" stopped`)
      } catch (err) {
        this.logger.error(`Failed to stop channel "${type}": ${(err as Error).message}`)
      }
    }
  }

  async broadcast(msg: ChannelMessage): Promise<void> {
    for (const [type, adapter] of this.adapters) {
      try {
        await adapter.send(msg)
      } catch (err) {
        this.logger.error(`Failed to send on channel "${type}": ${(err as Error).message}`)
      }
    }
  }

  async sendTo(type: ChannelType, msg: ChannelMessage): Promise<void> {
    const adapter = this.adapters.get(type)
    if (!adapter) {
      throw new Error(`Channel "${type}" not registered`)
    }
    await adapter.send(msg)
  }
}

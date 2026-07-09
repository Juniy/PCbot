import type { ChannelAdapter, ChannelMessage, ChannelType } from "../types"

export class StdoutChannel implements ChannelAdapter {
  type: ChannelType = "stdout"
  name = "stdout"

  async start(): Promise<void> {
    // Always available
  }

  async stop(): Promise<void> {
    // Nothing to clean up
  }

  async send(msg: ChannelMessage): Promise<void> {
    const timestamp = new Date(msg.timestamp).toLocaleTimeString()
    console.log(`[${timestamp}][${msg.channel}:${msg.from}] ${msg.content}`)
  }
}

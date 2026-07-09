import { expect, test, beforeEach } from "bun:test"
import { Notifier } from "../src/monitor/notifier"
import { ChannelManager } from "../src/channels"
import type { ChannelMessage, ChannelAdapter, ChannelType } from "../src/types"
import type { TaskDefinition, TaskExecution } from "../src/types"

let notifier: Notifier
let channelManager: ChannelManager
let capturedMessages: ChannelMessage[] = []

class MockAdapter implements ChannelAdapter {
  type: ChannelType = "stdout"
  name = "mock"
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  onMessage(_handler: (msg: ChannelMessage) => void): void {}
  async send(msg: ChannelMessage): Promise<void> {
    capturedMessages.push(msg)
  }
}

beforeEach(() => {
  capturedMessages = []
  channelManager = new ChannelManager()
  channelManager.register("stdout", new MockAdapter())
  notifier = new Notifier(channelManager)
})

const sampleTask: TaskDefinition = {
  id: "task-1",
  name: "Test Task",
  steps: [{ id: "s1", type: "prompt", name: "Step 1", input: "hello" }],
  maxRetries: 1,
  timeout: 30000,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const makeExec = (status: "completed" | "failed"): TaskExecution => ({
  id: "exec-1",
  taskId: "task-1",
  status,
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  currentStep: 1,
  stepResults: [{ stepId: "s1", status: "success", duration: 100, output: "ok", startedAt: new Date().toISOString() }],
  retryCount: 0,
})

function assertMsg(i = 0): ChannelMessage {
  const msg = capturedMessages[i]
  expect(msg).toBeDefined()
  return msg!
}

test("Notifier sends completion message on success", async () => {
  await notifier.notifyTaskComplete(makeExec("completed"), sampleTask)
  expect(capturedMessages.length).toBe(1)
  const msg = assertMsg()
  expect(msg.content).toContain("✅")
  expect(msg.content).toContain("Test Task")
})

test("Notifier sends failure message on failure", async () => {
  await notifier.notifyTaskComplete(makeExec("failed"), sampleTask)
  expect(capturedMessages.length).toBe(1)
  const msg = assertMsg()
  expect(msg.content).toContain("❌")
})

test("Notifier can toggle success notification", async () => {
  notifier.setNotifyOnSuccess(false)
  await notifier.notifyTaskComplete(makeExec("completed"), sampleTask)
  expect(capturedMessages.length).toBe(0)
})

test("Notifier sends server restart notification", async () => {
  await notifier.notifyServerRestart(1, 3, true)
  expect(capturedMessages.length).toBe(1)
  expect(assertMsg().content).toContain("🔄")
})

test("Notifier sends server restart failure notification", async () => {
  await notifier.notifyServerRestart(3, 3, false)
  expect(capturedMessages.length).toBe(1)
  expect(assertMsg().content).toContain("🔴")
})

test("Notifier sends health issue notification", async () => {
  await notifier.notifyHealthIssue("Server unreachable")
  expect(capturedMessages.length).toBe(1)
  expect(assertMsg().content).toContain("⚠️")
  expect(assertMsg().content).toContain("Server unreachable")
})

test("Notifier sends daily summary", async () => {
  await notifier.sendDailySummary(10, 2, 86400000)
  expect(capturedMessages.length).toBe(1)
  expect(assertMsg().content).toContain("📊")
  expect(assertMsg().content).toContain("10")
  expect(assertMsg().content).toContain("2")
  expect(assertMsg().content).toContain("83%") // 10/12 = 83%
})

import { expect, test, beforeEach, afterAll, describe } from "bun:test"
import { MetricsCollector } from "../src/monitor/metrics"
import { TaskStore } from "../src/engine/store"
import { ServerManager } from "../src/server/manager"
import { OpenCodeClient } from "../src/client"
import { HealthMonitor } from "../src/monitor"
import { updateConfig } from "../src/config"
import * as fs from "fs"
import * as path from "path"
import type { TaskExecution } from "../src/types"

const tempFiles: string[] = []

afterAll(() => {
  // Clean up temp store files
  for (const f of tempFiles) {
    try { fs.unlinkSync(f) } catch { /* ignore */ }
  }
})

let metrics: MetricsCollector
let store: TaskStore
let healthMonitor: HealthMonitor

beforeEach(() => {
  // Use unique store path per test to avoid cross-test pollution
  const storePath = `data/test-metrics-${Date.now()}-${Math.random()}.json`
  tempFiles.push(path.resolve(storePath))
  updateConfig({
    tasks: { storePath },
  })
  store = new TaskStore()
  // HealthMonitor needs ServerManager + OpenCodeClient
  const server = new ServerManager({} as any)
  const client = new OpenCodeClient()
  healthMonitor = new HealthMonitor(server, client)
  metrics = new MetricsCollector(store, healthMonitor)
})

test("MetricsCollector starts with empty snapshot", () => {
  const agg = metrics.getAggregate()
  expect(agg.tasksStarted).toBe(0)
  expect(agg.tasksCompleted).toBe(0)
  expect(agg.tasksFailed).toBe(0)
  expect(agg.successRate).toBe(1) // default when no data
})

test("MetricsCollector records task events", () => {
  metrics.recordTaskStart()
  metrics.recordTaskComplete(1000, true)
  metrics.recordTaskStart()
  metrics.recordTaskComplete(2000, false)

  const agg = metrics.getAggregate()
  expect(agg.tasksStarted).toBe(0) // counts from snapshots, not live
  // Live counts are 0 until snapshot
})

test("MetricsCollector snapshot captures hourly data", () => {
  metrics.recordTaskStart()
  metrics.recordTaskStart()
  metrics.recordTaskComplete(500, true)
  metrics.recordTaskComplete(1500, true)
  metrics.recordError()
  metrics.snapshot()

  const agg = metrics.getAggregate()
  expect(agg.tasksStarted).toBe(2) // recorded in snapshot
  expect(agg.tasksCompleted).toBe(2)
  expect(agg.tasksFailed).toBe(0)
  expect(agg.successRate).toBe(1)
})

test("MetricsCollector tracks failures", () => {
  metrics.recordTaskStart()
  metrics.recordTaskComplete(300, false)
  metrics.recordTaskStart()
  metrics.recordTaskComplete(200, false)
  metrics.snapshot()

  const agg = metrics.getAggregate()
  expect(agg.tasksFailed).toBe(2)
  expect(agg.successRate).toBe(0)
})

test("MetricsCollector getSummary returns formatted string", () => {
  metrics.recordTaskStart()
  metrics.recordTaskComplete(1000, true)
  metrics.snapshot()

  const summary = metrics.getSummary()
  expect(summary).toContain("Performance Metrics")
  expect(summary).toContain("100.0%") // success rate
})

test("MetricsCollector maintains snapshot limit", () => {
  // Add more than 7*24 snapshots
  for (let i = 0; i < 200; i++) {
    metrics.snapshot()
  }
  const agg = metrics.getAggregate()
  expect(agg.snapshotCount).toBeLessThanOrEqual(24 * 7)
})

test("MetricsCollector records server restarts", () => {
  metrics.recordServerRestart()
  metrics.recordServerRestart()
  metrics.snapshot()

  const agg = metrics.getAggregate()
  expect(agg.serverRestarts).toBe(2)
})

test("MetricsCollector reads from TaskStore for real-time data", () => {
  // Add executions to the store
  const now = new Date().toISOString()
  const exec1 = {
    id: "e1",
    taskId: "t1",
    status: "completed" as const,
    startedAt: new Date(Date.now() - 5000).toISOString(),
    completedAt: now,
    currentStep: 1,
    stepResults: [{ stepId: "s1", status: "success" as const, duration: 100, output: "ok", startedAt: now }],
    retryCount: 0,
  }
  const exec2 = {
    id: "e2",
    taskId: "t2",
    status: "failed" as const,
    startedAt: new Date(Date.now() - 3000).toISOString(),
    completedAt: now,
    currentStep: 1,
    stepResults: [{ stepId: "s1", status: "failed" as const, duration: 50, output: "err", error: "fail", startedAt: now }],
    retryCount: 1,
  }
  store.addExecution(exec1)
  store.addExecution(exec2)

  const agg = metrics.getAggregate()
  expect(agg.recentExecutions).toBeGreaterThanOrEqual(2)
})

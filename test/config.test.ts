import { expect, test } from "bun:test"
import { loadConfig, getConfig, updateConfig } from "../src/config"

test("loadConfig returns defaults", () => {
  const cfg = loadConfig()
  expect(cfg.server.hostname).toBe("127.0.0.1")
  expect(cfg.server.port).toBe(51899)
  expect(cfg.server.apiPort).toBe(51898)
  expect(cfg.channels.webhook?.port).toBe(51897)
  expect(cfg.monitor.intervalMs).toBe(30000)
})

test("loadConfig merges partial config", () => {
  const cfg = loadConfig({ server: { port: 9999 } })
  expect(cfg.server.port).toBe(9999)
  expect(cfg.server.hostname).toBe("127.0.0.1") // unchanged
})

test("updateConfig overrides values", () => {
  updateConfig({ server: { logLevel: "debug" } })
  expect(getConfig().server.logLevel).toBe("debug")
})

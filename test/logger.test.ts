import { expect, test } from "bun:test"
import { Logger } from "../src/monitor/logger"

test("Logger creates without error", () => {
  const logger = new Logger("test")
  expect(logger).toBeDefined()
})

test("Logger methods do not throw", () => {
  const logger = new Logger("test")
  expect(() => {
    logger.debug("debug message")
    logger.info("info message")
    logger.warn("warn message")
    logger.error("error message")
  }).not.toThrow()
})

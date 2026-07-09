import { expect, test } from "bun:test"
import { matchCron } from "../src/engine/scheduler"

test("matchCron * * * * * matches any time", () => {
  expect(matchCron("* * * * *", new Date("2026-07-09T12:30:00"))).toBe(true)
})

test("matchCron 30 * * * * matches specific minute", () => {
  expect(matchCron("30 * * * *", new Date("2026-07-09T12:30:00"))).toBe(true)
  expect(matchCron("30 * * * *", new Date("2026-07-09T12:31:00"))).toBe(false)
})

test("matchCron */5 * * * * matches every 5 minutes", () => {
  expect(matchCron("*/5 * * * *", new Date("2026-07-09T12:00:00"))).toBe(true)
  expect(matchCron("*/5 * * * *", new Date("2026-07-09T12:05:00"))).toBe(true)
  expect(matchCron("*/5 * * * *", new Date("2026-07-09T12:03:00"))).toBe(false)
})

test("matchCron 0,30 * * * * matches multiple values", () => {
  expect(matchCron("0,30 * * * *", new Date("2026-07-09T12:00:00"))).toBe(true)
  expect(matchCron("0,30 * * * *", new Date("2026-07-09T12:30:00"))).toBe(true)
  expect(matchCron("0,30 * * * *", new Date("2026-07-09T12:15:00"))).toBe(false)
})

test("matchCron handles range", () => {
  expect(matchCron("9-17 * * * *", new Date("2026-07-09T12:09:00"))).toBe(true)
  expect(matchCron("9-17 * * * *", new Date("2026-07-09T12:18:00"))).toBe(false)
})

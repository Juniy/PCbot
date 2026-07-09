import { expect, test } from "bun:test"
import { ulid } from "../src/engine/ulid"

test("ulid generates 26-character string", () => {
  const id = ulid()
  expect(id.length).toBe(26)
})

test("ulid is alphanumeric uppercase", () => {
  const id = ulid()
  expect(id).toMatch(/^[0-9A-Z]+$/)
})

test("ulids are sortable by time", () => {
  const ids = Array.from({ length: 10 }, () => ulid())
  for (let i = 1; i < ids.length; i++) {
    expect(ids[i]! > ids[i - 1]!).toBe(true)
  }
})

test("ulids are unique", () => {
  const ids = new Set(Array.from({ length: 100 }, () => ulid()))
  expect(ids.size).toBe(100)
})

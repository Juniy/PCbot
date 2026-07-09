import { expect, test, beforeEach } from "bun:test"
import { TaskStore } from "../src/engine/store"
import type { TaskDefinition, TaskExecution } from "../src/types"

let store: TaskStore

beforeEach(() => {
  store = new TaskStore()
})

const sampleTask: TaskDefinition = {
  id: "test-1",
  name: "Test Task",
  description: "A test task",
  steps: [
    { id: "step-1", type: "prompt", name: "Step 1", input: "Hello" },
  ],
  maxRetries: 1,
  timeout: 30000,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  tags: ["test"],
}

test("TaskStore add and get task", () => {
  store.addTask(sampleTask)
  const got = store.getTask("test-1")
  expect(got).toBeDefined()
  expect(got!.name).toBe("Test Task")
})

test("TaskStore get all tasks", () => {
  store.addTask(sampleTask)
  const all = store.getAllTasks()
  expect(all.length).toBe(1)
})

test("TaskStore delete task", () => {
  store.addTask(sampleTask)
  expect(store.deleteTask("test-1")).toBe(true)
  expect(store.getTask("test-1")).toBeUndefined()
})

test("TaskStore find tasks by tag", () => {
  store.addTask(sampleTask)
  const tagged = store.findTasksByTag("test")
  expect(tagged.length).toBe(1)
})

test("TaskStore add and get execution", () => {
  const exec: TaskExecution = {
    id: "exec-1",
    taskId: "test-1",
    status: "running",
    startedAt: new Date().toISOString(),
    currentStep: 0,
    stepResults: [],
    retryCount: 0,
  }
  store.addExecution(exec)
  expect(store.getExecution("exec-1")).toBeDefined()
})

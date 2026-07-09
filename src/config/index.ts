import type { AppConfig } from "../types"

type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T

const DEFAULT_CONFIG: AppConfig = {
  server: {
    hostname: "127.0.0.1",
    port: 51899,
    apiPort: 51898,
    logLevel: "info",
    opencodeBinary: "opencode",
    autoRestart: true,
    maxRestarts: 3,
  },
  monitor: {
    intervalMs: 30_000,
    restartBackoffMs: [10_000, 30_000, 60_000],
    logDir: "logs",
    logMaxSize: 10 * 1024 * 1024,
    logMaxFiles: 7,
    watchdogEnabled: false,
  },
  channels: {
    wechat: {
      enabled: false,
      mode: "webhook",
      gatewayUrl: "",
      gatewayToken: "",
      callbackUrl: "http://localhost:8080/api/channels/wechat",
    },
    webhook: {
      enabled: false,
      port: 51897,
    },
  },
  tasks: {
    storePath: "data/tasks.json",
    maxHistory: 1000,
    defaultTimeout: 300_000,
    defaultAgent: "sisyphus-junior",
  },
}

let currentConfig: AppConfig = { ...DEFAULT_CONFIG }

/**
 * Deep merge partial config into defaults
 */
export function loadConfig(partial?: DeepPartial<AppConfig>): AppConfig {
  if (partial) {
    currentConfig = deepMerge(DEFAULT_CONFIG, partial) as AppConfig
  }
  return getConfig()
}

export function getConfig(): AppConfig {
  return currentConfig
}

export function updateConfig(partial: DeepPartial<AppConfig>): AppConfig {
  currentConfig = deepMerge(currentConfig, partial) as AppConfig
  return currentConfig
}

function deepMerge(target: any, source: any): any {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] ?? {}, source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}

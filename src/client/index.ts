import { Logger } from "../monitor/logger"

// ===== Response Types =====
export interface SessionResponse {
  id: string
  agentID?: string
  modelID?: string
  title?: string
  createdAt?: string
  updatedAt?: string
  status?: string
}

export interface CreateSessionResult {
  data: SessionResponse
}

export interface PromptResult {
  data: {
    text: string
    message: string
    content?: string
    role?: string
    [key: string]: unknown
  }
}

export type GenericDataResult<T = unknown> = { data: T }

/**
 * OpenCode API client - lightweight HTTP wrapper around opencode serve
 */
export class OpenCodeClient {
  private baseUrl: string = ""
  private logger = new Logger("api-client")
  private maxRetries = 3
  private abortController = new AbortController()

  constructor(baseUrl?: string) {
    if (baseUrl) this.baseUrl = baseUrl
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url
  }

  get isConfigured(): boolean {
    return this.baseUrl.length > 0
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retries = this.maxRetries,
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new Error("Client not configured: call setBaseUrl() first")
    }

    const url = `${this.baseUrl}${path}`
    const options: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
      signal: this.abortController.signal,
    }
    if (body !== undefined) {
      options.body = JSON.stringify(body)
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, options)
        if (!response.ok) {
          const text = await response.text().catch(() => "")
          throw new Error(`HTTP ${response.status}: ${text}`)
        }
        const contentType = response.headers.get("content-type") ?? ""
        if (contentType.includes("application/json")) {
          return (await response.json()) as T
        }
        return (await response.text()) as unknown as T
      } catch (err) {
        const isLast = attempt === retries
        if (isLast) throw err
        this.logger.warn(`Request failed (attempt ${attempt + 1}/${retries + 1}): ${(err as Error).message}`)
        // Exponential backoff: 500ms, 1s, 2s
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)))
      }
    }
    throw new Error("Unreachable")
  }

  // ===== Health =====
  async health(): Promise<boolean> {
    try {
      const res = await this.request<{ status?: string }>("GET", "/health")
      return true
    } catch {
      return false
    }
  }

  // ===== Sessions (V1) =====
  async listSessions(params?: { limit?: number; cursor?: string }) {
    const query = new URLSearchParams()
    if (params?.limit) query.set("limit", String(params.limit))
    if (params?.cursor) query.set("cursor", params.cursor)
    const qs = query.toString()
    return this.request<GenericDataResult<SessionResponse[]>>("GET", `/sessions${qs ? `?${qs}` : ""}`)
  }

  async createSession(payload: { agent?: string; model?: string }) {
    return this.request<GenericDataResult<SessionResponse>>("POST", "/sessions", payload)
  }

  async getSession(id: string) {
    return this.request<GenericDataResult<SessionResponse>>("GET", `/sessions/${id}`)
  }

  async deleteSession(id: string) {
    return this.request<{ success: boolean }>("DELETE", `/sessions/${id}`)
  }

  async promptSession(sessionId: string, text: string) {
    return this.request<PromptResult>("POST", `/sessions/${sessionId}/prompt`, {
      text,
      stream: false,
    })
  }

  async getSessionMessages(sessionId: string) {
    return this.request<GenericDataResult<unknown[]>>("GET", `/sessions/${sessionId}/messages`)
  }

  // ===== Agents =====
  async listAgents() {
    return this.request<GenericDataResult<unknown[]>>("GET", "/agents")
  }

  // ===== Models =====
  async listModels() {
    return this.request<GenericDataResult<unknown[]>>("GET", "/models")
  }

  // ===== V2 API =====
  async v2Health() {
    return this.request<{ status: string }>("GET", "/api/v2/health")
  }

  async v2ListSessions(params?: { limit?: number }) {
    const query = params?.limit ? `?limit=${params.limit}` : ""
    return this.request<GenericDataResult<SessionResponse[]>>("GET", `/api/v2/sessions${query}`)
  }

  async v2CreateSession(payload?: { agentID?: string; modelID?: string }): Promise<CreateSessionResult> {
    // Map agentID → agent (OpenCode API v2 field name)
    const body: Record<string, unknown> = {}
    if (payload?.agentID) body.agent = payload.agentID
    if (payload?.modelID) body.model = { id: payload.modelID, providerID: "opencode" }
    return this.request<CreateSessionResult>("POST", "/api/v2/sessions", body)
  }

  async v2Prompt(sessionId: string, text: string): Promise<PromptResult> {
    return this.request<PromptResult>("POST", `/api/v2/sessions/${sessionId}/prompt`, {
      text,
      stream: false,
    })
  }

  dispose(): void {
    this.abortController.abort()
  }
}

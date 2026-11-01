import { ApiError, type ApiErrorCode } from "../contracts"

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

interface RequestOptions {
  reviver?: (key: string, value: unknown) => unknown
  timeoutMs?: number
}

type SecurityHandler = () => void

function apiRoot(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "")
  return normalized.endsWith("/api/v1") ? normalized : `${normalized}/api/v1`
}

function errorPayload(data: unknown): {
  code: ApiErrorCode
  message: string | null
  details: Record<string, unknown>
} {
  if (!data || typeof data !== "object") {
    return { code: "HTTP_ERROR", message: null, details: {} }
  }
  const root = data as Record<string, unknown>
  const envelope = root.error && typeof root.error === "object" ? (root.error as Record<string, unknown>) : root
  return {
    code: typeof envelope.code === "string" ? envelope.code : "HTTP_ERROR",
    message: typeof envelope.message === "string" ? envelope.message : null,
    details:
      envelope.details && typeof envelope.details === "object" ? (envelope.details as Record<string, unknown>) : {},
  }
}

async function responseBody(response: Response, reviver?: RequestOptions["reviver"]): Promise<unknown> {
  if (response.status === 204) return undefined
  const raw = await response.text()
  if (!raw) return undefined
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("json")) return raw
  try {
    return JSON.parse(raw, reviver)
  } catch {
    throw new ApiError(response.status, "INVALID_RESPONSE", "Máy chủ trả về dữ liệu không hợp lệ.")
  }
}

export class HttpClient {
  readonly root: string
  private readonly defaultTimeoutMs: number
  private csrfToken: string | null = null
  private sessionRevisionValue = 0
  private unauthorizedHandler: SecurityHandler | null = null
  private csrfFailureHandler: SecurityHandler | null = null

  constructor(baseUrl: string, defaultTimeoutMs = 15_000) {
    this.root = apiRoot(baseUrl)
    this.defaultTimeoutMs = defaultTimeoutMs
  }

  setCsrfToken(token: string | null): void {
    this.csrfToken = token
    this.sessionRevisionValue += 1
  }

  get sessionRevision(): number {
    return this.sessionRevisionValue
  }

  setUnauthorizedHandler(handler: SecurityHandler): void {
    this.unauthorizedHandler = handler
  }

  setCsrfFailureHandler(handler: SecurityHandler): void {
    this.csrfFailureHandler = handler
  }

  async request<T>(method: HttpMethod, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), options.timeoutMs ?? this.defaultTimeoutMs)
    const headers: Record<string, string> = { Accept: "application/json" }
    if (body !== undefined) headers["Content-Type"] = "application/json"
    if (method !== "GET" && this.csrfToken) headers["x-csrf-token"] = this.csrfToken

    try {
      const response = await fetch(`${this.root}${path.startsWith("/") ? path : `/${path}`}`, {
        method,
        headers,
        credentials: "include",
        signal: controller.signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await responseBody(response, options.reviver)
      if (!response.ok) {
        const normalized = errorPayload(data)
        if (response.status === 401) this.unauthorizedHandler?.()
        if (response.status === 403 && normalized.code === "CSRF_TOKEN_INVALID") this.csrfFailureHandler?.()
        throw new ApiError(
          response.status,
          normalized.code,
          normalized.message ?? `Yêu cầu thất bại (${response.status}).`,
          normalized.details,
        )
      }
      return data as T
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError(0, "REQUEST_TIMEOUT", "Máy chủ phản hồi quá chậm. Vui lòng thử lại.")
      }
      throw new ApiError(0, "NETWORK_ERROR", "Không thể kết nối tới máy chủ. Kiểm tra mạng rồi thử lại.")
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request("GET", path, undefined, options)
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request("POST", path, body, options)
  }

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request("PUT", path, body, options)
  }

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request("PATCH", path, body, options)
  }

  delete<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request("DELETE", path, body, options)
  }
}

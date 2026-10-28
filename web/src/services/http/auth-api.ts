import { ApiError } from "../contracts"
import type { HttpClient } from "./http-client"

export interface AuthenticatedUser {
  id: number
  username: string
  displayName: string
  organizationId: number
  venueId: number
}

export interface AuthSession {
  user: AuthenticatedUser
  permissions: string[]
  csrfToken: string
  expiresAt?: string
}

function validSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") return false
  const session = value as Partial<AuthSession>
  const user = session.user as Partial<AuthenticatedUser> | undefined
  return Boolean(
    user &&
    Number.isSafeInteger(user.id) &&
    typeof user.username === "string" &&
    typeof user.displayName === "string" &&
    Number.isSafeInteger(user.organizationId) &&
    Number.isSafeInteger(user.venueId) &&
    Array.isArray(session.permissions) &&
    session.permissions.every((permission) => typeof permission === "string") &&
    typeof session.csrfToken === "string" &&
    session.csrfToken,
  )
}

export class AuthApi {
  private readonly client: HttpClient

  constructor(client: HttpClient) {
    this.client = client
  }

  private accept(value: unknown): AuthSession {
    if (!validSession(value)) {
      throw new ApiError(0, "INVALID_RESPONSE", "Máy chủ trả về phiên đăng nhập không hợp lệ.")
    }
    this.client.setCsrfToken(value.csrfToken)
    return value
  }

  async login(username: string, password: string): Promise<AuthSession> {
    const result = await this.client.post<unknown>("/auth/login", { username, password })
    return this.accept(result)
  }

  async me(): Promise<AuthSession> {
    const result = await this.client.get<unknown>("/auth/me")
    return this.accept(result)
  }

  async logout(): Promise<void> {
    await this.client.post<void>("/auth/logout")
    this.client.setCsrfToken(null)
  }

  clear(): void {
    this.client.setCsrfToken(null)
  }
}

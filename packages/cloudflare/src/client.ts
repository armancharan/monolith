import { resolveCloudflareAuth, type ResolvedAuth } from "./auth.js"
import { CloudflareAuthError } from "./auth.js"
import { err, ok, type Result } from "./result.js"

const API_BASE = "https://api.cloudflare.com/client/v4"

export class CloudflareApiError extends Error {
  readonly _tag = "CloudflareApiError"

  constructor(
    message: string,
    readonly status: number,
    readonly cfErrors?: ReadonlyArray<{ code?: number; message?: string }>
  ) {
    super(message)
    this.name = "CloudflareApiError"
  }
}

interface CfResponse<T> {
  success: boolean
  errors?: Array<{ code?: number; message?: string }>
  messages?: string[]
  result: T
}

export interface CloudflareUser {
  id: string
  email: string
}

export interface CloudflareAccount {
  id: string
  name: string
}

export interface WhoamiResult {
  auth: ResolvedAuth
  user: CloudflareUser
  accounts: CloudflareAccount[]
}

export interface CloudflareClientOptions {
  token: string
  auth?: ResolvedAuth
  fetchImpl?: typeof fetch
}

export class CloudflareClient {
  readonly #token: string
  readonly #auth?: ResolvedAuth
  readonly #fetch: typeof fetch

  constructor(options: CloudflareClientOptions) {
    this.#token = options.token
    this.#auth = options.auth
    this.#fetch = options.fetchImpl ?? fetch
  }

  static async create(options?: {
    projectDir?: string
    fetchImpl?: typeof fetch
  }): Promise<Result<CloudflareClient, CloudflareAuthError>> {
    const authResult = await resolveCloudflareAuth({ projectDir: options?.projectDir })
    if (!authResult.ok) {
      return authResult
    }

    return ok(
      new CloudflareClient({
        token: authResult.value.token,
        auth: authResult.value,
        fetchImpl: options?.fetchImpl
      })
    )
  }

  async request<T>(
    path: string,
    init?: RequestInit
  ): Promise<Result<T, CloudflareApiError>> {
    const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`

    let response: Response
    try {
      response = await this.#fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.#token}`,
          "Content-Type": "application/json",
          ...init?.headers
        }
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      return err(new CloudflareApiError(`Cloudflare API request failed: ${message}`, 0))
    }

    let body: CfResponse<T>
    try {
      body = (await response.json()) as CfResponse<T>
    } catch {
      return err(
        new CloudflareApiError(
          `Cloudflare API returned non-JSON response (${response.status})`,
          response.status
        )
      )
    }

    if (!response.ok || !body.success) {
      const cfMessage = body.errors?.[0]?.message ?? response.statusText
      return err(
        new CloudflareApiError(
          `Cloudflare API error: ${cfMessage}`,
          response.status,
          body.errors
        )
      )
    }

    return ok(body.result)
  }

  async whoami(): Promise<Result<WhoamiResult, CloudflareAuthError | CloudflareApiError>> {
    if (!this.#auth) {
      return err(new CloudflareAuthError("whoami requires auth metadata from CloudflareClient.create()"))
    }

    const userResult = await this.request<CloudflareUser>("/user")
    if (!userResult.ok) {
      return userResult
    }

    const accountsResult = await this.request<CloudflareAccount[]>("/accounts?per_page=50")
    if (!accountsResult.ok) {
      return accountsResult
    }

    return ok({
      auth: this.#auth,
      user: userResult.value,
      accounts: accountsResult.value
    })
  }

  async getAccountId(): Promise<Result<string, CloudflareApiError>> {
    const accountsResult = await this.request<CloudflareAccount[]>("/accounts?per_page=1")
    if (!accountsResult.ok) {
      return accountsResult
    }

    const account = accountsResult.value[0]
    if (!account) {
      return err(new CloudflareApiError("No Cloudflare accounts found for this token", 404))
    }

    return ok(account.id)
  }
}

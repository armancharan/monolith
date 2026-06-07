import { Context, Effect, Layer } from "effect"
import { resolveCloudflareAuth, type ResolvedAuth } from "../auth.js"
import { CloudflareApiError, CloudflareAuthError } from "../errors.js"

const API_BASE = "https://api.cloudflare.com/client/v4"

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

export interface MakeCloudflareClientOptions {
  token: string
  auth?: ResolvedAuth
  fetchImpl?: typeof fetch
}

export class CloudflareClient extends Context.Service<
  CloudflareClient,
  {
    readonly request: <T>(
      path: string,
      init?: RequestInit
    ) => Effect.Effect<T, CloudflareApiError>
    readonly whoami: () => Effect.Effect<
      WhoamiResult,
      CloudflareAuthError | CloudflareApiError
    >
    readonly getAccountId: () => Effect.Effect<string, CloudflareApiError>
  }
>()("CloudflareClient") {}

export const makeCloudflareClient = (
  options: MakeCloudflareClientOptions
) => {
  const token = options.token
  const auth = options.auth
  const fetchImpl = options.fetchImpl ?? fetch

  const request = <T>(
    path: string,
    init?: RequestInit
  ): Effect.Effect<T, CloudflareApiError> =>
    Effect.gen(function* () {
      const url = path.startsWith("http")
        ? path
        : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`

      const response = yield* Effect.tryPromise({
        try: () =>
          fetchImpl(url, {
            ...init,
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              ...init?.headers
            }
          }),
        catch: (cause) =>
          new CloudflareApiError({
            message: `Cloudflare API request failed: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
            status: 0
          })
      })

      const body = yield* Effect.tryPromise({
        try: () => response.json() as Promise<CfResponse<T>>,
        catch: () =>
          new CloudflareApiError({
            message: `Cloudflare API returned non-JSON response (${response.status})`,
            status: response.status
          })
      })

      if (!response.ok || !body.success) {
        const cfMessage = body.errors?.[0]?.message ?? response.statusText
        return yield* Effect.fail(
          new CloudflareApiError({
            message: `Cloudflare API error: ${cfMessage}`,
            status: response.status,
            cfErrors: body.errors
          })
        )
      }

      return body.result
    })

  const whoami = (): Effect.Effect<
    WhoamiResult,
    CloudflareAuthError | CloudflareApiError
  > =>
    Effect.gen(function* () {
      if (!auth) {
        return yield* Effect.fail(
          new CloudflareAuthError({
            message:
              "whoami requires auth metadata from makeCloudflareClientLayer()"
          })
        )
      }

      const user = yield* request<CloudflareUser>("/user")
      const accounts = yield* request<CloudflareAccount[]>("/accounts?per_page=50")

      return { auth, user, accounts }
    })

  const getAccountId = (): Effect.Effect<string, CloudflareApiError> =>
    Effect.gen(function* () {
      const accounts = yield* request<CloudflareAccount[]>("/accounts?per_page=1")
      const account = accounts[0]
      if (!account) {
        return yield* Effect.fail(
          new CloudflareApiError({
            message: "No Cloudflare accounts found for this token",
            status: 404
          })
        )
      }
      return account.id
    })

  return CloudflareClient.of({ request, whoami, getAccountId })
}

export const makeCloudflareClientLayer = (
  projectDir?: string,
  fetchImpl?: typeof fetch
): Layer.Layer<CloudflareClient, CloudflareAuthError> =>
  Layer.effect(
    CloudflareClient,
    Effect.gen(function* () {
      const resolvedAuth = yield* resolveCloudflareAuth({ projectDir })
      return makeCloudflareClient({
        token: resolvedAuth.token,
        auth: resolvedAuth,
        fetchImpl
      })
    })
  )

export const CloudflareClientLive = makeCloudflareClientLayer()

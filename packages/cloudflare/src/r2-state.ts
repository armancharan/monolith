import {
  stateObjectKey,
  StateError,
  type MonolithState,
  type RemoteStateBackend
} from "@monolith/core"
import { Effect } from "effect"
import { resolveCloudflareAuth } from "./auth.js"
import { makeCloudflareClient } from "./services/CloudflareClient.js"

export interface R2StateBackendOptions {
  bucket: string
  accountId?: string
  accessKeyId?: string
  secretAccessKey?: string
  fetchImpl?: typeof fetch
}

function r2S3Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`
}

function resolveAccountId(
  options: R2StateBackendOptions,
  projectDir?: string
): Effect.Effect<string, StateError> {
  if (options.accountId) {
    return Effect.succeed(options.accountId)
  }

  return Effect.gen(function* () {
    const auth = yield* Effect.catch(
      resolveCloudflareAuth({ projectDir }),
      (error) =>
        Effect.fail(new StateError({ message: `R2 state backend: ${error.message}` }))
    )

    const client = makeCloudflareClient({
      token: auth.token,
      auth,
      fetchImpl: options.fetchImpl
    })

    return yield* Effect.catch(
      client.getAccountId(),
      (error) =>
        Effect.fail(new StateError({ message: `R2 state backend: ${error.message}` }))
    )
  })
}

function resolveR2Credentials(
  env: NodeJS.ProcessEnv = process.env
): { accessKeyId: string; secretAccessKey: string } | undefined {
  const accessKeyId =
    env.MONOLITH_STATE_R2_ACCESS_KEY_ID?.trim() ??
    env.R2_ACCESS_KEY_ID?.trim() ??
    env.AWS_ACCESS_KEY_ID?.trim()
  const secretAccessKey =
    env.MONOLITH_STATE_R2_SECRET_ACCESS_KEY?.trim() ??
    env.R2_SECRET_ACCESS_KEY?.trim() ??
    env.AWS_SECRET_ACCESS_KEY?.trim()

  if (accessKeyId && secretAccessKey) {
    return { accessKeyId, secretAccessKey }
  }

  return undefined
}

/**
 * Minimal S3 SigV4 for R2 GetObject/PutObject (AWS4-HMAC-SHA256).
 * Scoped to monolith state object keys only.
 */
async function signS3Request(
  method: "GET" | "PUT",
  url: URL,
  credentials: { accessKeyId: string; secretAccessKey: string },
  body?: string
): Promise<Record<string, string>> {
  const encoder = new TextEncoder()
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "")
  const dateStamp = amzDate.slice(0, 8)
  const region = "auto"
  const service = "s3"
  const payloadHash = await crypto.subtle.digest("SHA-256", encoder.encode(body ?? ""))
  const payloadHashHex = Buffer.from(payloadHash).toString("hex")

  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHashHex}\nx-amz-date:${amzDate}\n`
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date"
  const canonicalRequest = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHashHex
  ].join("\n")

  const canonicalRequestHash = Buffer.from(
    await crypto.subtle.digest("SHA-256", encoder.encode(canonicalRequest))
  ).toString("hex")

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    canonicalRequestHash
  ].join("\n")

  async function hmac(key: ArrayBuffer | string, data: string): Promise<ArrayBuffer> {
    const keyMaterial =
      typeof key === "string" ? encoder.encode(key) : key
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyMaterial,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    )
    return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data))
  }

  const kDate = await hmac(`AWS4${credentials.secretAccessKey}`, dateStamp)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, service)
  const kSigning = await hmac(kService, "aws4_request")
  const signature = Buffer.from(await hmac(kSigning, stringToSign)).toString("hex")

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`
  ].join(", ")

  return {
    Authorization: authorization,
    "x-amz-content-sha256": payloadHashHex,
    "x-amz-date": amzDate,
    "content-type": "application/json"
  }
}

export class R2StateBackend implements RemoteStateBackend {
  readonly kind = "r2" as const
  readonly #bucket: string
  readonly #accountId?: string
  readonly #accessKeyId?: string
  readonly #secretAccessKey?: string
  readonly #fetch: typeof fetch
  readonly #projectDir?: string

  constructor(options: R2StateBackendOptions & { projectDir?: string }) {
    this.#bucket = options.bucket
    this.#accountId = options.accountId
    this.#accessKeyId = options.accessKeyId
    this.#secretAccessKey = options.secretAccessKey
    this.#fetch = options.fetchImpl ?? fetch
    this.#projectDir = options.projectDir
  }

  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
    options?: { projectDir?: string; fetchImpl?: typeof fetch }
  ): Effect.Effect<R2StateBackend, StateError> {
    const bucket = env.MONOLITH_STATE_R2_BUCKET?.trim()
    if (!bucket) {
      return Effect.fail(
        new StateError({
          message: "MONOLITH_STATE_R2_BUCKET is required when MONOLITH_STATE_BACKEND=r2"
        })
      )
    }

    const creds = resolveR2Credentials(env)
    if (!creds) {
      return Effect.fail(
        new StateError({
          message:
            "R2 credentials required: set MONOLITH_STATE_R2_ACCESS_KEY_ID and MONOLITH_STATE_R2_SECRET_ACCESS_KEY"
        })
      )
    }

    return Effect.succeed(
      new R2StateBackend({
        bucket,
        accountId: env.MONOLITH_STATE_R2_ACCOUNT_ID?.trim() ?? env.CLOUDFLARE_ACCOUNT_ID?.trim(),
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        projectDir: options?.projectDir,
        fetchImpl: options?.fetchImpl
      })
    )
  }

  #objectUrl(key: string): Effect.Effect<URL, StateError> {
    const bucket = this.#bucket
    const accountId = this.#accountId
    const fetchImpl = this.#fetch
    const projectDir = this.#projectDir

    return Effect.gen(function* () {
      const resolvedAccountId = yield* resolveAccountId(
        { bucket, accountId, fetchImpl },
        projectDir
      )
      const endpoint = r2S3Endpoint(resolvedAccountId)
      return new URL(`/${bucket}/${key}`, endpoint)
    })
  }

  pull(stage: string): Effect.Effect<MonolithState, StateError> {
    const accessKeyId = this.#accessKeyId
    const secretAccessKey = this.#secretAccessKey
    const fetchImpl = this.#fetch
    const objectUrl = (key: string) => this.#objectUrl(key)

    return Effect.gen(function* () {
      const key = stateObjectKey(stage)
      const url = yield* objectUrl(key)

      if (!accessKeyId || !secretAccessKey) {
        return yield* Effect.fail(new StateError({ message: "R2 credentials not configured" }))
      }

      const headers = yield* Effect.tryPromise({
        try: () =>
          signS3Request("GET", url, {
            accessKeyId,
            secretAccessKey
          }),
        catch: (cause) =>
          new StateError({
            message: `R2 pull failed: ${cause instanceof Error ? cause.message : String(cause)}`
          })
      })

      const response = yield* Effect.tryPromise({
        try: () => fetchImpl(url.toString(), { method: "GET", headers }),
        catch: (cause) =>
          new StateError({
            message: `R2 pull failed: ${cause instanceof Error ? cause.message : String(cause)}`
          })
      })

      if (response.status === 404) {
        return yield* Effect.fail(new StateError({ message: `Remote state not found: ${key}` }))
      }

      if (!response.ok) {
        return yield* Effect.fail(new StateError({ message: `R2 pull failed: HTTP ${response.status}` }))
      }

      const parsed = yield* Effect.tryPromise({
        try: () => response.json() as Promise<MonolithState>,
        catch: () =>
          new StateError({ message: `Could not parse remote state JSON for stage "${stage}"` })
      })

      if (!parsed.stackName || !parsed.stage || !Array.isArray(parsed.resources)) {
        return yield* Effect.fail(
          new StateError({ message: `Invalid remote state JSON for stage "${stage}"` })
        )
      }

      return parsed
    })
  }

  push(stage: string, state: MonolithState): Effect.Effect<void, StateError> {
    const accessKeyId = this.#accessKeyId
    const secretAccessKey = this.#secretAccessKey
    const fetchImpl = this.#fetch
    const objectUrl = (key: string) => this.#objectUrl(key)

    return Effect.gen(function* () {
      const key = stateObjectKey(stage)
      const url = yield* objectUrl(key)

      if (!accessKeyId || !secretAccessKey) {
        return yield* Effect.fail(new StateError({ message: "R2 credentials not configured" }))
      }

      const body = `${JSON.stringify(state, null, 2)}\n`
      const headers = yield* Effect.tryPromise({
        try: () =>
          signS3Request(
            "PUT",
            url,
            {
              accessKeyId,
              secretAccessKey
            },
            body
          ),
        catch: (cause) =>
          new StateError({
            message: `R2 push failed: ${cause instanceof Error ? cause.message : String(cause)}`
          })
      })

      const response = yield* Effect.tryPromise({
        try: () =>
          fetchImpl(url.toString(), {
            method: "PUT",
            headers,
            body
          }),
        catch: (cause) =>
          new StateError({
            message: `R2 push failed: ${cause instanceof Error ? cause.message : String(cause)}`
          })
      })

      if (!response.ok) {
        return yield* Effect.fail(new StateError({ message: `R2 push failed: HTTP ${response.status}` }))
      }
    })
  }
}

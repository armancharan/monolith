import {
  err,
  ok,
  stateObjectKey,
  StateError,
  type MonolithState,
  type RemoteStateBackend,
  type Result
} from "@monolith/core"
import { CloudflareClient } from "./client.js"
import { resolveCloudflareAuth } from "./auth.js"

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

async function resolveAccountId(
  options: R2StateBackendOptions,
  projectDir?: string
): Promise<Result<string, StateError>> {
  if (options.accountId) {
    return ok(options.accountId)
  }

  const authResult = await resolveCloudflareAuth({ projectDir })
  if (!authResult.ok) {
    return err(new StateError(`R2 state backend: ${authResult.error.message}`))
  }

  const clientResult = await CloudflareClient.create({ projectDir, fetchImpl: options.fetchImpl })
  if (!clientResult.ok) {
    return err(new StateError(`R2 state backend: ${clientResult.error.message}`))
  }

  const accountResult = await clientResult.value.getAccountId()
  if (!accountResult.ok) {
    return err(new StateError(`R2 state backend: ${accountResult.error.message}`))
  }

  return ok(accountResult.value)
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
  ): Result<R2StateBackend, StateError> {
    const bucket = env.MONOLITH_STATE_R2_BUCKET?.trim()
    if (!bucket) {
      return err(new StateError("MONOLITH_STATE_R2_BUCKET is required when MONOLITH_STATE_BACKEND=r2"))
    }

    const creds = resolveR2Credentials(env)
    if (!creds) {
      return err(
        new StateError(
          "R2 credentials required: set MONOLITH_STATE_R2_ACCESS_KEY_ID and MONOLITH_STATE_R2_SECRET_ACCESS_KEY"
        )
      )
    }

    return ok(
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

  async #objectUrl(key: string): Promise<Result<URL, StateError>> {
    const accountResult = await resolveAccountId(
      { bucket: this.#bucket, accountId: this.#accountId, fetchImpl: this.#fetch },
      this.#projectDir
    )
    if (!accountResult.ok) {
      return accountResult
    }

    const endpoint = r2S3Endpoint(accountResult.value)
    return ok(new URL(`/${this.#bucket}/${key}`, endpoint))
  }

  async pull(stage: string): Promise<Result<MonolithState, StateError>> {
    const key = stateObjectKey(stage)
    const urlResult = await this.#objectUrl(key)
    if (!urlResult.ok) {
      return urlResult
    }

    if (!this.#accessKeyId || !this.#secretAccessKey) {
      return err(new StateError("R2 credentials not configured"))
    }

    const headers = await signS3Request("GET", urlResult.value, {
      accessKeyId: this.#accessKeyId,
      secretAccessKey: this.#secretAccessKey
    })

    let response: Response
    try {
      response = await this.#fetch(urlResult.value.toString(), { method: "GET", headers })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      return err(new StateError(`R2 pull failed: ${message}`))
    }

    if (response.status === 404) {
      return err(new StateError(`Remote state not found: ${key}`))
    }

    if (!response.ok) {
      return err(new StateError(`R2 pull failed: HTTP ${response.status}`))
    }

    try {
      const parsed = (await response.json()) as MonolithState
      if (!parsed.stackName || !parsed.stage || !Array.isArray(parsed.resources)) {
        return err(new StateError(`Invalid remote state JSON for stage "${stage}"`))
      }
      return ok(parsed)
    } catch {
      return err(new StateError(`Could not parse remote state JSON for stage "${stage}"`))
    }
  }

  async push(stage: string, state: MonolithState): Promise<Result<void, StateError>> {
    const key = stateObjectKey(stage)
    const urlResult = await this.#objectUrl(key)
    if (!urlResult.ok) {
      return urlResult
    }

    if (!this.#accessKeyId || !this.#secretAccessKey) {
      return err(new StateError("R2 credentials not configured"))
    }

    const body = `${JSON.stringify(state, null, 2)}\n`
    const headers = await signS3Request(
      "PUT",
      urlResult.value,
      { accessKeyId: this.#accessKeyId, secretAccessKey: this.#secretAccessKey },
      body
    )

    let response: Response
    try {
      response = await this.#fetch(urlResult.value.toString(), {
        method: "PUT",
        headers,
        body
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      return err(new StateError(`R2 push failed: ${message}`))
    }

    if (!response.ok) {
      return err(new StateError(`R2 push failed: HTTP ${response.status}`))
    }

    return ok(undefined)
  }
}

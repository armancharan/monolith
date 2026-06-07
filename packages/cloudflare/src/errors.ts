import { Data } from "effect"

export class CloudflareAuthError extends Data.TaggedError("CloudflareAuthError")<{
  readonly message: string
}> {}

export class CloudflareApiError extends Data.TaggedError("CloudflareApiError")<{
  readonly message: string
  readonly status: number
  readonly cfErrors?: ReadonlyArray<{ code?: number; message?: string }>
}> {}

export class WranglerParseError extends Data.TaggedError("WranglerParseError")<{
  readonly message: string
}> {}

export class WranglerError extends Data.TaggedError("WranglerError")<{
  readonly message: string
  readonly exitCode: number
}> {}

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { parse as parseToml } from "smol-toml"
import { CloudflareAuthError } from "./errors.js"

export type AuthSource =
  | "env:api_token"
  | "project:wrangler"
  | "global:wrangler"

export interface ResolvedAuth {
  token: string
  source: AuthSource
  configPath?: string
}

interface WranglerAuthToml {
  oauth_token?: string
  expiration_time?: string
}

function wranglerConfigCandidates(projectDir?: string): string[] {
  const paths: string[] = []

  if (projectDir) {
    paths.push(join(projectDir, ".wrangler", "config", "default.toml"))
  }

  const wranglerHome = process.env.WRANGLER_HOME
  if (wranglerHome) {
    paths.push(join(wranglerHome, "config", "default.toml"))
  }

  const home = homedir()
  if (process.platform === "darwin") {
    paths.push(join(home, "Library", "Preferences", ".wrangler", "config", "default.toml"))
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(home, ".config")
  paths.push(join(xdgConfig, "wrangler", "config", "default.toml"))
  paths.push(join(xdgConfig, ".wrangler", "config", "default.toml"))
  paths.push(join(home, ".wrangler", "config", "default.toml"))

  return paths
}

function readWranglerToken(
  configPath: string
): Effect.Effect<string, CloudflareAuthError> {
  return Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => readFile(configPath, "utf8"),
      catch: () =>
        new CloudflareAuthError({
          message: `Could not read wrangler auth config: ${configPath}`
        })
    })

    let parsed: WranglerAuthToml
    try {
      parsed = parseToml(text) as WranglerAuthToml
    } catch {
      return yield* Effect.fail(
        new CloudflareAuthError({
          message: `Invalid wrangler auth TOML: ${configPath}`
        })
      )
    }

    const token = parsed.oauth_token?.trim()
    if (!token) {
      return yield* Effect.fail(
        new CloudflareAuthError({
          message: `No oauth_token in ${configPath}`
        })
      )
    }

    if (parsed.expiration_time) {
      const expiresAt = Date.parse(parsed.expiration_time)
      if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
        return yield* Effect.fail(
          new CloudflareAuthError({
            message: `Wrangler OAuth token expired (${parsed.expiration_time}). Run \`wrangler login\`.`
          })
        )
      }
    }

    return token
  })
}

export function resolveCloudflareAuth(options?: {
  projectDir?: string
  /** Override config search paths (tests only). Empty array forces missing-credentials error. */
  configPaths?: string[]
}): Effect.Effect<ResolvedAuth, CloudflareAuthError> {
  return Effect.gen(function* () {
    const envToken = process.env.CLOUDFLARE_API_TOKEN?.trim()
    if (envToken) {
      return { token: envToken, source: "env:api_token" as const }
    }

    const candidates = options?.configPaths ?? wranglerConfigCandidates(options?.projectDir)
    for (const configPath of candidates) {
      const token = yield* Effect.catch(readWranglerToken(configPath), () =>
        Effect.succeed(undefined as string | undefined)
      )
      if (token) {
        const source: AuthSource = configPath.includes(`${join(".wrangler", "config")}`)
          ? "project:wrangler"
          : "global:wrangler"
        return {
          token,
          source,
          configPath
        }
      }
    }

    return yield* Effect.fail(
      new CloudflareAuthError({
        message:
          "No Cloudflare credentials found. Set CLOUDFLARE_API_TOKEN or run `wrangler login`."
      })
    )
  })
}

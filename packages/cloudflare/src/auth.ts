import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse as parseToml } from "smol-toml"
import { err, ok, type Result } from "./result.js"

export type AuthSource =
  | "env:api_token"
  | "project:wrangler"
  | "global:wrangler"

export interface ResolvedAuth {
  token: string
  source: AuthSource
  configPath?: string
}

export class CloudflareAuthError extends Error {
  readonly _tag = "CloudflareAuthError"

  constructor(message: string) {
    super(message)
    this.name = "CloudflareAuthError"
  }
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

async function readWranglerToken(
  configPath: string
): Promise<Result<string, CloudflareAuthError>> {
  let text: string
  try {
    text = await readFile(configPath, "utf8")
  } catch {
    return err(new CloudflareAuthError(`Could not read wrangler auth config: ${configPath}`))
  }

  let parsed: WranglerAuthToml
  try {
    parsed = parseToml(text) as WranglerAuthToml
  } catch {
    return err(new CloudflareAuthError(`Invalid wrangler auth TOML: ${configPath}`))
  }

  const token = parsed.oauth_token?.trim()
  if (!token) {
    return err(new CloudflareAuthError(`No oauth_token in ${configPath}`))
  }

  if (parsed.expiration_time) {
    const expiresAt = Date.parse(parsed.expiration_time)
    if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
      return err(
        new CloudflareAuthError(
          `Wrangler OAuth token expired (${parsed.expiration_time}). Run \`wrangler login\`.`
        )
      )
    }
  }

  return ok(token)
}

export async function resolveCloudflareAuth(options?: {
  projectDir?: string
  /** Override config search paths (tests only). Empty array forces missing-credentials error. */
  configPaths?: string[]
}): Promise<Result<ResolvedAuth, CloudflareAuthError>> {
  const envToken = process.env.CLOUDFLARE_API_TOKEN?.trim()
  if (envToken) {
    return ok({ token: envToken, source: "env:api_token" })
  }

  const candidates = options?.configPaths ?? wranglerConfigCandidates(options?.projectDir)
  for (const configPath of candidates) {
    const tokenResult = await readWranglerToken(configPath)
    if (tokenResult.ok) {
      const source: AuthSource = configPath.includes(`${join(".wrangler", "config")}`)
        ? "project:wrangler"
        : "global:wrangler"
      return ok({
        token: tokenResult.value,
        source,
        configPath
      })
    }
  }

  return err(
    new CloudflareAuthError(
      "No Cloudflare credentials found. Set CLOUDFLARE_API_TOKEN or run `wrangler login`."
    )
  )
}

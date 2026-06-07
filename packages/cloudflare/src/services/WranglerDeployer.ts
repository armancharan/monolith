import { spawn } from "node:child_process"
import { Context, Effect, Layer } from "effect"

export interface WranglerDeployOutcome {
  exitCode: number
  output: string
}

export class WranglerDeployer extends Context.Service<
  WranglerDeployer,
  {
    readonly runCommand: (
      args: string[],
      options?: { cwd?: string; env?: NodeJS.ProcessEnv }
    ) => Effect.Effect<WranglerDeployOutcome, string>
    readonly runDeploy: (
      projectDir: string,
      configPath?: string
    ) => Effect.Effect<WranglerDeployOutcome, string>
  }
>()("WranglerDeployer") {}

const runSubprocess = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Effect.Effect<WranglerDeployOutcome, string> =>
  Effect.tryPromise({
    try: () =>
      new Promise<WranglerDeployOutcome>((resolve, reject) => {
        const child = spawn(command, args, {
          cwd: options?.cwd,
          env: options?.env ?? process.env,
          stdio: ["ignore", "pipe", "pipe"]
        })

        let output = ""
        let errorOutput = ""

        child.stdout?.on("data", (chunk: Buffer | string) => {
          output += chunk.toString()
        })

        child.stderr?.on("data", (chunk: Buffer | string) => {
          errorOutput += chunk.toString()
        })

        child.on("close", (code) => {
          const combined = [output, errorOutput].filter(Boolean).join("\n")
          resolve({
            exitCode: code ?? 1,
            output: combined
          })
        })

        child.on("error", (error) => {
          reject(error.message)
        })
      }),
    catch: (cause) => (typeof cause === "string" ? cause : String(cause))
  })

export const makeWranglerDeployer = () => {
  const runCommand = (
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv }
  ): Effect.Effect<WranglerDeployOutcome, string> => runSubprocess("npx", args, options)

  const runDeploy = (
    projectDir: string,
    configPath?: string
  ): Effect.Effect<WranglerDeployOutcome, string> => {
    const args = ["wrangler", "deploy"]
    if (configPath) {
      args.push("--config", configPath)
    }
    return runCommand(args, { cwd: projectDir })
  }

  return WranglerDeployer.of({ runCommand, runDeploy })
}

export const WranglerDeployerLive = Layer.succeed(
  WranglerDeployer,
  makeWranglerDeployer()
)

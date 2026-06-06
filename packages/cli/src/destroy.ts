const DEFAULT_STAGE = "dev"

function parseArgs(args: string[]): { stage: string } {
  const parsed = { stage: DEFAULT_STAGE }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--stage" && args[index + 1]) {
      parsed.stage = args[index + 1]
      index += 1
    }
  }

  return parsed
}

/** M1 stub — full teardown deferred post-M1 (see AGENTS.md non-goals). */
export async function runDestroy(args: string[]): Promise<number> {
  const { stage } = parseArgs(args)
  console.log(`monolith destroy --stage ${stage} — stub (M1 non-goal)`)
  console.log("Worker + binding teardown not implemented yet. Use Cloudflare dashboard or `wrangler delete` manually.")
  return 0
}

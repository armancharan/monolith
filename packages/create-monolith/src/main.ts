import { runCreateMonolith } from "./create.js"

const code = await runCreateMonolith(process.argv.slice(2))
process.exit(code)

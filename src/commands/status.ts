import { listProjectDirs, findSessionFiles } from '../lib/paths.js'
import { parseSessionFile } from '../lib/parser.js'
import {
  filterRollingWindow,
  loadConfig,
  getDefaultConfig,
  sumOutputTokens,
  sumBillingTokens,
  calcBurnRate,
  isFirstRun,
} from '../lib/quota.js'

/** Token activity summary across all projects in the last 5 hours. */
export function statusCommand(): void {
  if (isFirstRun()) {
    console.log()
    console.log('⚠️  No plan configured. Run: claude-token-lens setup')
    console.log()
  }

  const config = loadConfig() ?? getDefaultConfig()
  const dirs = listProjectDirs()

  let totalWindowOutput = 0
  let totalWindowBilling = 0
  let activeProjects = 0
  const allWindowedTurns: ReturnType<typeof filterRollingWindow> = []

  for (const dir of dirs) {
    const files = findSessionFiles(dir)
    for (const file of files) {
      const turns = parseSessionFile(file)
      const windowed = filterRollingWindow(turns.filter(t => !t.isSidechain))
      if (windowed.length > 0) activeProjects++
      totalWindowOutput += sumOutputTokens(windowed)
      totalWindowBilling += sumBillingTokens(windowed)
      allWindowedTurns.push(...windowed)
    }
  }

  const burnRate = calcBurnRate(allWindowedTurns, 10, t => t.usage.output)

  console.log()
  console.log(`claude-token-lens status  ─  plan: ${config.plan.toUpperCase()}`)
  console.log()
  console.log(`   Output tokens (5h window) : ${totalWindowOutput.toLocaleString()}`)
  console.log(`   Billing tokens (5h window): ${totalWindowBilling.toLocaleString()}`)
  if (burnRate > 0) {
    console.log(`   Burn rate                 : ${burnRate.toLocaleString()} output tok/min`)
  }
  console.log()
  console.log(`   ${activeProjects} of ${dirs.length} projects active in window`)
  console.log()
  console.log(`   ⚠️  For your actual quota limit, use /usage inside Claude Code.`)
  console.log(`   This tool can't reliably compare these numbers to Anthropic's`)
  console.log(`   internal counters — the rate-limit formula is not published.`)
  console.log()
  console.log(`   Run 'claude-token-lens sessions' to see per-project breakdown.`)
  console.log()
}

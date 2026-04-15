import { listProjectDirs, findSessionFiles } from '../lib/paths.js'
import { parseSessionFile } from '../lib/parser.js'
import {
  filterRollingWindow,
  filterWeeklyWindow,
  loadConfig,
  getDefaultConfig,
  sumOutputTokens,
  sumBillingTokens,
  calcBurnRate,
  isFirstRun,
} from '../lib/quota.js'

/** Token activity summary across all projects in the last 5 hours and 7 days. */
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
  let totalWeeklyOutput = 0
  let totalWeeklyBilling = 0
  let activeProjects = 0
  let projectsWithSessions = 0
  const allWindowedTurns: ReturnType<typeof filterRollingWindow> = []

  for (const dir of dirs) {
    const files = findSessionFiles(dir)
    if (files.length === 0) continue
    projectsWithSessions++
    let projectIsActive = false
    for (const file of files) {
      const turns = parseSessionFile(file)
      const mainTurns = turns.filter(t => !t.isSidechain)
      const windowed = filterRollingWindow(mainTurns)
      const weekly = filterWeeklyWindow(mainTurns)
      if (windowed.length > 0) projectIsActive = true
      totalWindowOutput += sumOutputTokens(windowed)
      totalWindowBilling += sumBillingTokens(windowed)
      totalWeeklyOutput += sumOutputTokens(weekly)
      totalWeeklyBilling += sumBillingTokens(weekly)
      allWindowedTurns.push(...windowed)
    }
    if (projectIsActive) activeProjects++
  }

  const burnRate = calcBurnRate(allWindowedTurns, 10, t => t.usage.output)
  const limit = config.limit

  // 5h quota bar
  const pct5h = limit ? Math.min(100, Math.round((totalWindowOutput / limit) * 100)) : null
  const bar5h = pct5h != null ? progressBar(pct5h) : null
  const barColor5h = pct5h != null ? (pct5h >= 80 ? '🔴' : pct5h >= 60 ? '🟡' : '🟢') : ''

  console.log()
  console.log(`claude-token-lens status  ─  plan: ${config.plan.toUpperCase()}`)
  console.log()

  // 5h window
  if (bar5h != null) {
    console.log(`   5h window quota (est.)`)
    console.log(`   ${barColor5h} ${bar5h} ${pct5h}%`)
    console.log(`   ${totalWindowOutput.toLocaleString()} / ${limit!.toLocaleString()} output tokens`)
  } else {
    console.log(`   5h window  : ${totalWindowOutput.toLocaleString()} output tokens`)
  }
  console.log(`   Billing    : ${totalWindowBilling.toLocaleString()} tok`)
  if (burnRate > 0) {
    console.log(`   Burn rate  : ${burnRate.toLocaleString()} output tok/min`)
  }
  console.log()

  // 7-day window
  console.log(`   7-day window (Anthropic enforces weekly limits since Aug 2025)`)
  console.log(`   Output     : ${totalWeeklyOutput.toLocaleString()} output tokens`)
  console.log(`   Billing    : ${totalWeeklyBilling.toLocaleString()} tok`)
  console.log()

  console.log(`   ${activeProjects} of ${projectsWithSessions} projects active in 5h window`)
  console.log()
  console.log(`   ⚠️  For your actual quota limits, use /stats inside Claude Code.`)
  console.log(`   Anthropic's internal counters are not published — these are estimates.`)
  console.log(`   Limits also reduce during peak hours (5am–11am PT weekdays).`)
  console.log()
  console.log(`   Run 'claude-token-lens sessions' to see per-project breakdown.`)
  console.log()
}

function progressBar(pct: number, width = 28): string {
  const filled = Math.round((pct / 100) * width)
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']'
}

import { listProjectDirs, findSessionFiles } from '../lib/paths.js'
import { parseSessionFile } from '../lib/parser.js'
import {
  filterRollingWindow,
  loadConfig,
  getDefaultConfig,
  sumOutputTokens,
  calcBurnRate,
  calcETA,
  formatDuration,
  isFirstRun,
} from '../lib/quota.js'

function progressBar(pct: number, width = 30): string {
  const filled = Math.round((pct / 100) * width)
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']'
}

/** One-line global quota summary across all projects — the `/usage` equivalent. */
export function statusCommand(): void {
  if (isFirstRun()) {
    console.log()
    console.log('⚠️  No plan configured. Run: claude-token-lens setup')
    console.log()
  }

  const config = loadConfig() ?? getDefaultConfig()
  const limit = config.limit

  const dirs = listProjectDirs()

  // Aggregate output tokens in the 5h rolling window across ALL projects
  let totalWindowOutput = 0
  let activeProjects = 0
  const allWindowedTurns: ReturnType<typeof filterRollingWindow> = []

  for (const dir of dirs) {
    const files = findSessionFiles(dir)
    for (const file of files) {
      const turns = parseSessionFile(file)
      const windowed = filterRollingWindow(turns.filter(t => !t.isSidechain))
      if (windowed.length > 0) activeProjects++
      totalWindowOutput += sumOutputTokens(windowed)
      allWindowedTurns.push(...windowed)
    }
  }

  const pct = limit ? Math.min(100, Math.round((totalWindowOutput / limit) * 100)) : null
  const burnRate = calcBurnRate(allWindowedTurns, 10, t => t.usage.output)
  const eta = limit ? calcETA(totalWindowOutput, limit, burnRate) : null

  console.log()
  console.log(`claude-token-lens status  ─  plan: ${config.plan.toUpperCase()}${limit ? ` (~${(limit / 1000).toFixed(0)}k est.)` : ''}`)
  console.log()

  if (limit && pct !== null) {
    const barColor = pct >= 80 ? '⚠️ ' : pct >= 60 ? '  ' : '  '
    console.log(`${barColor}${progressBar(pct)}  ${pct}%`)
    console.log(`   ${totalWindowOutput.toLocaleString()} / ${limit.toLocaleString()} output tokens  (5h rolling window)`)
    if (burnRate > 0) {
      console.log(`   Burn: ${burnRate.toLocaleString()} tok/min  │  ETA: ${eta != null && pct >= 40 ? formatDuration(eta) + (eta < 20 ? ' ⚠️  CRITICAL' : '') : 'N/A'}`)
    }
  } else {
    console.log(`   ${totalWindowOutput.toLocaleString()} output tokens in 5h window  (API mode — no limit)`)
  }

  console.log()
  console.log(`   ${dirs.length} project${dirs.length !== 1 ? 's' : ''} found  │  ${activeProjects} active in window`)
  console.log(`   Run 'claude-token-lens sessions' to see per-project breakdown`)
  console.log()
}

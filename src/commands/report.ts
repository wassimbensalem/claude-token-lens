import { detectCurrentProjectDir, listProjectDirs } from '../lib/paths.js'
import { parseProject } from '../lib/parser.js'
import { buildAttribution } from '../lib/attributor.js'
import {
  filterRollingWindow,
  calcBurnRate,
  calcETA,
  calcWindowReset,
  formatDuration,
  loadConfig,
  getDefaultConfig,
  PLAN_LIMITS,
} from '../lib/quota.js'
import * as path from 'path'

interface ReportOptions {
  project?: string
  json?: boolean
  top?: number
}

export function reportCommand(opts: ReportOptions = {}): void {
  let projectDir: string | null = null
  let projectName = ''

  if (opts.project) {
    projectDir = opts.project
    projectName = path.basename(opts.project)
  } else {
    projectDir = detectCurrentProjectDir()
    if (projectDir) {
      projectName = path.basename(projectDir)
        .replace(/^-/, '').replace(/-/g, '/').replace(/^Users\/[^/]+\//, '~/')
    }
  }

  if (!projectDir) {
    console.error('No Claude Code project found for the current directory.')
    process.exit(1)
  }

  const turns = parseProject(projectDir)
  const windowed = filterRollingWindow(turns.filter(t => !t.isSidechain))
  const sidechains = turns.filter(t => t.isSidechain)
  const allAttributed = [...windowed, ...sidechains]

  const config = loadConfig() ?? getDefaultConfig()
  const limit = config.limit
  const totalTokens = allAttributed.reduce((s, t) => s + t.usage.total, 0)
  const pct = limit ? Math.min(100, Math.round((totalTokens / limit) * 100)) : null
  const burnRate = calcBurnRate(windowed)
  const eta = limit ? calcETA(totalTokens, limit, burnRate) : null
  const resetIn = calcWindowReset(windowed)
  const attribution = buildAttribution(allAttributed)
  const topN = opts.top ?? 20

  if (opts.json) {
    const out = {
      project: projectName,
      plan: config.plan,
      limit,
      totalTokens,
      pct,
      burnRatePerMin: burnRate,
      etaMinutes: eta,
      windowResetsInMinutes: resetIn,
      attribution: attribution.slice(0, topN),
    }
    console.log(JSON.stringify(out, null, 2))
    return
  }

  // Human-readable
  console.log(`\nclaude-token-lens report`)
  console.log(`${'─'.repeat(60)}`)
  console.log(`Project : ${projectName}`)
  console.log(`Plan    : ${config.plan.toUpperCase()}${limit ? ` (${(limit / 1000).toFixed(0)}k limit)` : ''}`)
  console.log()

  if (limit) {
    const bar = progressBar(pct ?? 0)
    console.log(`Quota   : ${bar} ${pct}%`)
    console.log(`         ${totalTokens.toLocaleString()} / ${limit.toLocaleString()} tokens`)
    console.log(`Reset   : ${resetIn != null ? `in ${formatDuration(resetIn)}` : 'no data'}`)
    console.log(`Burn    : ${burnRate.toLocaleString()} tok/min`)
    console.log(`ETA     : ${eta != null ? formatDuration(eta) + (eta < 20 ? ' ⚠️  CRITICAL' : '') : 'N/A'}`)
  } else {
    console.log(`Tokens  : ${totalTokens.toLocaleString()} (API mode — no quota)`)
    console.log(`Burn    : ${burnRate.toLocaleString()} tok/min`)
  }

  console.log()
  console.log(`${'─'.repeat(60)}`)
  console.log(
    'Source'.padEnd(38) +
    'Tokens'.padStart(10) +
    '%'.padStart(7) +
    'tok/min'.padStart(10)
  )
  console.log(`${'─'.repeat(60)}`)

  const slice = attribution.slice(0, topN)
  for (const a of slice) {
    const rowPct = totalTokens > 0 ? Math.round((a.tokens / totalTokens) * 100) : 0
    const rowRate = calcBurnRate(allAttributed.filter(t => t.label === a.label))
    console.log(
      a.label.slice(0, 37).padEnd(38) +
      a.tokens.toLocaleString().padStart(10) +
      `${rowPct}%`.padStart(7) +
      (rowRate > 0 ? rowRate.toLocaleString().padStart(10) : ''.padStart(10))
    )
  }

  if (attribution.length > topN) {
    console.log(`  ... and ${attribution.length - topN} more sources`)
  }

  console.log(`${'─'.repeat(60)}`)
  console.log(`${windowed.length} turns in 5h window  │  ${turns.length} total turns`)
  console.log()
}

function progressBar(pct: number, width = 30): string {
  const filled = Math.round((pct / 100) * width)
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']'
}

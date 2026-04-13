import { detectCurrentProjectDir, resolveProjectName, findSessionFiles } from '../lib/paths.js'
import { parseProject, parseSessionFile } from '../lib/parser.js'
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
  sumOutputTokens,
} from '../lib/quota.js'
import * as path from 'path'
import * as fs from 'fs'

interface ReportOptions {
  project?: string
  session?: string
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
      projectName = resolveProjectName(projectDir)
    }
  }

  if (!projectDir) {
    console.error('No Claude Code project found for the current directory.')
    process.exit(1)
  }

  // If --session given, resolve to a specific .jsonl file
  let sessionLabel: string | null = null
  let turns = parseProject(projectDir)

  if (opts.session) {
    const sessionFiles = findSessionFiles(projectDir)
    // Match by full UUID or unambiguous prefix
    const match = sessionFiles.find(f => {
      const stem = path.basename(f, '.jsonl')
      return stem === opts.session || stem.startsWith(opts.session!)
    })
    if (!match) {
      console.error(`Session "${opts.session}" not found in ${projectDir}`)
      console.error('Available sessions:')
      sessionFiles.forEach(f => {
        const stem = path.basename(f, '.jsonl')
        const age = Math.round((Date.now() - fs.statSync(f).mtimeMs) / 60000)
        const ageStr = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.floor(age/60)}h ago` : `${Math.floor(age/1440)}d ago`
        console.error(`  ${stem}  (${ageStr})`)
      })
      process.exit(1)
    }
    sessionLabel = path.basename(match, '.jsonl')
    turns = parseSessionFile(match)
  }
  // For single-session mode: no rolling window filter — show all turns in that session
  const windowed = sessionLabel
    ? turns.filter(t => !t.isSidechain)
    : filterRollingWindow(turns.filter(t => !t.isSidechain))
  const sidechains = turns.filter(t => t.isSidechain)
  const allAttributed = [...windowed, ...sidechains]

  const config = loadConfig() ?? getDefaultConfig()
  const limit = config.limit
  // totalTokens = billing-weighted cost (shown in attribution table)
  const totalTokens = allAttributed.reduce((s, t) => s + t.usage.total, 0)
  // quotaTokens = output tokens only (what Anthropic rate-limits on)
  const quotaTokens = sumOutputTokens(windowed)
  const pct = limit ? Math.min(100, Math.round((quotaTokens / limit) * 100)) : null
  const burnRate = calcBurnRate(windowed)
  const eta = limit ? calcETA(quotaTokens, limit, burnRate) : null
  const resetIn = sessionLabel ? null : calcWindowReset(windowed)
  const attribution = buildAttribution(allAttributed)
  const topN = opts.top ?? 20

  if (opts.json) {
    const out = {
      project: projectName,
      ...(sessionLabel ? { session: sessionLabel } : {}),
      plan: config.plan,
      limit,
      quotaTokens,
      totalBillingTokens: totalTokens,
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
  if (sessionLabel) {
    console.log(`Session : ${sessionLabel}`)
  }
  console.log(`Plan    : ${config.plan.toUpperCase()}${limit ? ` (${(limit / 1000).toFixed(0)}k output-token limit)` : ''}`)
  console.log()

  if (limit) {
    const bar = progressBar(pct ?? 0)
    console.log(`Quota   : ${bar} ${pct}%`)
    console.log(`         ${quotaTokens.toLocaleString()} / ${limit.toLocaleString()} output tokens used`)
    console.log(`Cost    : ${totalTokens.toLocaleString()} billing-weighted tokens`)
    console.log(`Reset   : ${resetIn != null ? `in ${formatDuration(resetIn)}` : 'no data'}`)
    console.log(`Burn    : ${burnRate.toLocaleString()} tok/min`)
    console.log(`ETA     : ${eta != null ? formatDuration(eta) + (eta < 20 ? ' ⚠️  CRITICAL' : '') : 'N/A'}`)
  } else {
    console.log(`Output  : ${quotaTokens.toLocaleString()} tokens (API mode — no quota)`)
    console.log(`Cost    : ${totalTokens.toLocaleString()} billing-weighted tokens`)
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
  if (sessionLabel) {
    console.log(`${turns.length} turns in session`)
  } else {
    console.log(`${windowed.length} turns in 5h window  │  ${turns.length} total turns`)
  }
  console.log()
}

function progressBar(pct: number, width = 30): string {
  const filled = Math.round((pct / 100) * width)
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']'
}

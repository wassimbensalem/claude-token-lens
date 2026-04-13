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
  sumOutputTokens,
  sumBillingTokens,
  isFirstRun,
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
        const ageStr = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.floor(age / 60)}h ago` : `${Math.floor(age / 1440)}d ago`
        console.error(`  ${stem}  (${ageStr})`)
      })
      process.exit(1)
    }
    sessionLabel = path.basename(match, '.jsonl')
    turns = parseSessionFile(match)
  }

  // For single-session mode: no rolling window filter
  const windowed = sessionLabel
    ? turns.filter(t => !t.isSidechain)
    : filterRollingWindow(turns.filter(t => !t.isSidechain))
  const sidechains = turns.filter(t => t.isSidechain)
  const allAttributed = [...windowed, ...sidechains]

  const config = loadConfig() ?? getDefaultConfig()
  const limit = config.limit

  // quotaTokens = output tokens only (what Anthropic rate-limits on)
  const quotaTokens = sumOutputTokens(windowed)
  // generationTokens = input + cacheCreation + output per source (attribution)
  const generationTokens = allAttributed.reduce((s, t) => s + t.usage.total, 0)
  // billingTokens = generation + cacheRead×0.1 (true billing cost, not per-source)
  const billingTokens = sumBillingTokens(allAttributed)
  const cacheReadCost = billingTokens - generationTokens

  const pct = limit ? Math.min(100, Math.round((quotaTokens / limit) * 100)) : null

  // Burn rate for display: billing-weighted (shows true cost rate)
  const displayBurnRate = calcBurnRate(windowed)
  // Burn rate for ETA: output tokens only (same unit as quotaTokens and limit)
  const quotaBurnRate = calcBurnRate(windowed, 10, t => t.usage.output)

  const eta = limit ? calcETA(quotaTokens, limit, quotaBurnRate) : null
  const resetIn = sessionLabel ? null : calcWindowReset(windowed)
  const attribution = buildAttribution(allAttributed)
  const topN = opts.top ?? 20
  const hasDirectBucket = attribution.some(a => a.label === '[direct]')

  if (opts.json) {
    const out = {
      project: projectName,
      ...(sessionLabel ? { session: sessionLabel } : {}),
      plan: config.plan,
      limit,
      quotaTokens,
      generationTokens,
      billingTokens,
      cacheReadCost,
      pct,
      displayBurnRatePerMin: displayBurnRate,
      quotaBurnRatePerMin: quotaBurnRate,
      etaMinutes: eta,
      windowResetsInMinutes: resetIn,
      attribution: attribution.slice(0, topN),
    }
    console.log(JSON.stringify(out, null, 2))
    return
  }

  // First-run warning
  if (isFirstRun()) {
    console.log()
    console.log(`⚠️  No plan configured — defaulting to MAX5 (88k). Quota % may be wrong.`)
    console.log(`   Run: claude-token-lens setup`)
    console.log()
  }

  // Human-readable
  console.log(`\nclaude-token-lens report`)
  console.log(`${'─'.repeat(60)}`)
  console.log(`Project : ${projectName}`)
  if (sessionLabel) {
    console.log(`Session : ${sessionLabel}`)
  }
  console.log(`Plan    : ${config.plan.toUpperCase()}${limit ? ` (~${(limit / 1000).toFixed(0)}k est. limit)` : ''}`)
  console.log()

  if (limit) {
    const bar = progressBar(pct ?? 0)
    console.log(`Quota~  : ${bar} ${pct}%  (est. — Anthropic limit not published)`)
    console.log(`         ${quotaTokens.toLocaleString()} / ${limit.toLocaleString()} output tokens`)
    console.log(`Cost    : ${generationTokens.toLocaleString()} gen + ${cacheReadCost.toLocaleString()} cache = ${billingTokens.toLocaleString()} billing-tok`)
    console.log(`Reset   : ${resetIn != null ? `in ${formatDuration(resetIn)}` : 'no data'}`)
    console.log(`Burn    : ${displayBurnRate.toLocaleString()} billing-tok/min`)
    console.log(`ETA     : ${eta != null ? formatDuration(eta) + (eta < 20 ? ' ⚠️  CRITICAL' : '') : 'N/A'}`)
  } else {
    console.log(`Output  : ${quotaTokens.toLocaleString()} tokens (API mode — no quota)`)
    console.log(`Cost    : ${generationTokens.toLocaleString()} gen + ${cacheReadCost.toLocaleString()} cache = ${billingTokens.toLocaleString()} billing-tok`)
    console.log(`Burn    : ${displayBurnRate.toLocaleString()} billing-tok/min`)
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
    const rowPct = generationTokens > 0 ? Math.round((a.tokens / generationTokens) * 100) : 0
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
  if (hasDirectBucket) {
    console.log(`Note: [direct] = assistant text responses with no tool calls or skill annotation`)
  }
  console.log()
}

function progressBar(pct: number, width = 30): string {
  const filled = Math.round((pct / 100) * width)
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']'
}

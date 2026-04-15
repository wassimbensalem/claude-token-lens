import { detectCurrentProjectDir, resolveProjectName, findSessionFiles } from '../lib/paths.js'
import { parseProject, parseSessionFile } from '../lib/parser.js'
import { buildAttribution, truncateLabel } from '../lib/attributor.js'
import { watchProject } from '../lib/watcher.js'
import {
  filterRollingWindow,
  filterWeeklyWindow,
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
  watch?: boolean
  week?: boolean
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

  // Validate the project directory exists (explicit --project path could be wrong)
  if (!fs.existsSync(projectDir)) {
    console.error(`Project directory not found: ${projectDir}`)
    console.error('Check the path or run: claude-token-lens sessions  to see available projects.')
    process.exit(1)
  }

  // If --session given, resolve to a specific .jsonl file.
  // "current" is a special alias for the most recently modified session.
  let sessionLabel: string | null = null
  let turns = parseProject(projectDir)

  if (opts.session) {
    const sessionFiles = findSessionFiles(projectDir)

    // Resolve "current" → most recently modified session (files are sorted mtime desc)
    if (opts.session === 'current') {
      if (sessionFiles.length === 0) {
        console.error('No sessions found in this project.')
        process.exit(1)
      }
      opts.session = path.basename(sessionFiles[0]!, '.jsonl')
    }

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

  // For single-session mode: no rolling window filter on main turns.
  // Sidechains always get the same window treatment as main turns for consistency.
  const mainTurns = turns.filter(t => !t.isSidechain)
  const windowed = sessionLabel ? mainTurns : filterRollingWindow(mainTurns)
  const sidechains = sessionLabel
    ? turns.filter(t => t.isSidechain)
    : filterRollingWindow(turns.filter(t => t.isSidechain))
  const allAttributed = [...windowed, ...sidechains]

  // Weekly window — only meaningful in project mode (not per-session)
  const weeklyTurns = !sessionLabel ? filterWeeklyWindow(mainTurns) : null
  const weeklyOutput = weeklyTurns ? sumOutputTokens(weeklyTurns) : null
  const weeklyBilling = weeklyTurns ? sumBillingTokens(weeklyTurns) : null

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

  // Input overhead analysis
  const turnCount = allAttributed.length
  const totalInput = allAttributed.reduce((s, t) => s + t.usage.input, 0)
  const totalCacheRead = allAttributed.reduce((s, t) => s + t.usage.cacheRead, 0)
  const totalCacheCreation = allAttributed.reduce((s, t) => s + t.usage.cacheCreation, 0)
  // Use (billingTokens - generationTokens) for cacheReadBillingCost rather than
  // Math.round(totalCacheRead * 0.1) — this keeps the input-overhead section
  // numerically consistent with the cost line above, which derives cacheReadCost
  // the same way. The difference is that billingTokens = sum(per-turn billingTotal)
  // where billingTotal already applied Math.round per turn; rounding the aggregate
  // instead gives a slightly different number (off by ~1 token per 10 turns).
  const cacheReadBillingCost = billingTokens - generationTokens
  const cacheReadPctOfBilling = billingTokens > 0
    ? Math.round((cacheReadBillingCost / billingTokens) * 100)
    : 0
  // Total context per turn = input + cacheRead (everything the model actually processed)
  // "input" alone is near-zero when prompt caching is active — cache carries the context
  const avgContextPerTurn = turnCount > 0
    ? Math.round((totalInput + totalCacheRead) / turnCount)
    : 0
  const avgNewInputPerTurn = turnCount > 0 ? Math.round(totalInput / turnCount) : 0
  // Heavy turns = top 5 by total context processed (input + cacheRead)
  const heavyTurns = [...allAttributed]
    .sort((a, b) => (b.usage.input + b.usage.cacheRead) - (a.usage.input + a.usage.cacheRead))
    .slice(0, 5)
    .filter(t => t.usage.input + t.usage.cacheRead > 0)
  const heavyThreshold = Math.max(20_000, avgContextPerTurn * 2)
  const heavyTurnCount = allAttributed.filter(
    t => t.usage.input + t.usage.cacheRead > heavyThreshold
  ).length

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
      inputAnalysis: {
        turnCount,
        avgContextPerTurn,
        avgNewInputPerTurn,
        totalCacheCreation,
        totalCacheRead,
        cacheReadBillingCost,
        cacheReadPctOfBilling,
        heavyTurnCount,
        heavyThreshold,
        heaviestTurns: heavyTurns.map(t => ({
          label: t.label,
          newInput: t.usage.input,
          cacheRead: t.usage.cacheRead,
          output: t.usage.output,
          timestamp: t.timestamp.toISOString(),
        })),
      },
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
    console.log(`Reset   : ${resetIn != null ? `oldest turn drops in ${formatDuration(resetIn)}` : 'no data'}`)
    console.log(`Burn    : ${displayBurnRate.toLocaleString()} billing-tok/min`)
    console.log(`ETA     : ${eta != null && (pct ?? 0) >= 40 ? formatDuration(eta) + (eta < 20 ? ' ⚠️  CRITICAL' : '') : 'N/A (< 40% used)'}`)
  } else {
    console.log(`Output  : ${quotaTokens.toLocaleString()} tokens (API mode — no quota)`)
    console.log(`Cost    : ${generationTokens.toLocaleString()} gen + ${cacheReadCost.toLocaleString()} cache = ${billingTokens.toLocaleString()} billing-tok`)
    console.log(`Burn    : ${displayBurnRate.toLocaleString()} billing-tok/min`)
  }

  // Weekly window summary (project mode only)
  if (weeklyOutput != null && weeklyBilling != null) {
    console.log(`7-day   : ${weeklyOutput.toLocaleString()} output  │  ${weeklyBilling.toLocaleString()} billing-tok  (weekly limit tracking)`)
  }

  console.log()
  console.log(`${'─'.repeat(60)}`)
  console.log(
    'Source'.padEnd(38) +
    'Tokens'.padStart(10) +
    '%'.padStart(7) +
    'out/min'.padStart(10)
  )
  console.log(`${'─'.repeat(60)}`)

  const slice = attribution.slice(0, topN)
  for (const a of slice) {
    const rowPct = generationTokens > 0 ? Math.round((a.tokens / generationTokens) * 100) : 0
    const rowRate = calcBurnRate(allAttributed.filter(t => t.label === a.label), 10, t => t.usage.output)
    console.log(
      truncateLabel(a.label, 37).padEnd(38) +
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

  // Input overhead section
  console.log()
  console.log(`${'─'.repeat(60)}`)
  console.log(`Input overhead`)
  console.log(`${'─'.repeat(60)}`)
  console.log(
    `Avg context / turn   : ${avgContextPerTurn.toLocaleString().padStart(10)} tok` +
    `  (input + cache — everything the model processed)`
  )
  console.log(
    `Avg new input / turn : ${avgNewInputPerTurn.toLocaleString().padStart(10)} tok` +
    `  (fresh tokens: user messages + uncached tool results)`
  )
  console.log(
    `Cache creation total : ${totalCacheCreation.toLocaleString().padStart(10)} tok` +
    `  (written to cache, charged once at full price)`
  )
  console.log(
    `Cache read total     : ${totalCacheRead.toLocaleString().padStart(10)} tok` +
    `  → ${cacheReadBillingCost.toLocaleString()} billing-tok (at 0.1×)`
  )
  console.log(
    `Cache % of cost      : ${String(cacheReadPctOfBilling + '%').padStart(10)}` +
    `  (grows as session ages — run /compact to reset)`
  )
  if (heavyTurnCount > 0) {
    console.log(
      `Heavy turns (> ${(heavyThreshold / 1000).toFixed(0)}k ctx): ` +
      `${heavyTurnCount} of ${turnCount} turns  ← peak bleeding points`
    )
  }

  if (heavyTurns.length > 0) {
    console.log()
    console.log(`Top 5 turns by total context  (input + cacheRead)`)
    console.log(
      'Source'.padEnd(38) +
      'NewInput'.padStart(10) +
      'CacheRead'.padStart(12) +
      'Output'.padStart(10)
    )
    for (const t of heavyTurns) {
      console.log(
        truncateLabel(t.label, 37).padEnd(38) +
        t.usage.input.toLocaleString().padStart(10) +
        t.usage.cacheRead.toLocaleString().padStart(12) +
        t.usage.output.toLocaleString().padStart(10)
      )
    }
    console.log()
    console.log(`What to look for:`)
    console.log(`  High NewInput on tool:Bash/Read  → large tool output fed into next turn`)
    console.log(`  High NewInput on [direct]        → CLAUDE.md or hook injecting large context`)
    console.log(`  Rising CacheRead across turns    → session aging; /compact will reset this`)
  }

  console.log()
  console.log(`⚠  This report tracks the 5h rolling window only.`)
  console.log(`   Anthropic also enforces weekly limits (since Aug 2025) and`)
  console.log(`   reduces limits during peak hours (5am–11am PT).`)
  console.log(`   Run /stats inside Claude Code for the authoritative quota view.`)
  console.log()

  // --watch: re-render on every .jsonl change
  if (opts.watch && !sessionLabel) {
    console.log(`Watching for changes… (Ctrl+C to stop)\n`)
    watchProject(projectDir!, () => {
      process.stdout.write('\x1b[2J\x1b[H') // clear screen
      reportCommand({ ...opts, watch: false })
      console.log(`\nWatching for changes… (Ctrl+C to stop)`)
    })
    // Keep process alive
    process.stdin.resume()
  }
}

function progressBar(pct: number, width = 30): string {
  const filled = Math.round((pct / 100) * width)
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']'
}

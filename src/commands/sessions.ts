import { listProjectDirs, findSessionFiles, resolveProjectName } from '../lib/paths.js'
import { parseSessionFile } from '../lib/parser.js'
import { filterRollingWindow, loadConfig, getDefaultConfig, sumOutputTokens } from '../lib/quota.js'
import * as path from 'path'
import * as fs from 'fs'

interface SessionsOptions {
  detail?: boolean
}

function formatAge(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function quotaBar(pct: number, width = 10): string {
  const filled = Math.min(width, Math.round((pct / 100) * width))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export function sessionsCommand(opts: SessionsOptions = {}): void {
  const dirs = listProjectDirs()

  if (dirs.length === 0) {
    console.log('No Claude Code projects found.')
    console.log(`Expected: ~/.claude/projects/`)
    return
  }

  const config = loadConfig() ?? getDefaultConfig()
  const limit = config.limit

  interface ProjectInfo {
    dir: string
    name: string
    sessions: number
    totalTokens: number
    windowTokens: number
    lastActive: number
  }

  const projects: ProjectInfo[] = []

  for (const dir of dirs) {
    const files = findSessionFiles(dir)
    if (files.length === 0) continue

    // Aggregate across all sessions
    // windowTokens = output tokens only (quota-relevant)
    // allTokens    = billing-weighted total (cost view)
    let allTokens = 0
    let windowTokens = 0
    for (const file of files) {
      const turns = parseSessionFile(file)
      const windowed = filterRollingWindow(turns.filter(t => !t.isSidechain))
      allTokens += turns.reduce((s, t) => s + t.usage.total, 0)
      windowTokens += sumOutputTokens(windowed)
    }

    const latestFile = files[0]
    const lastActive = latestFile ? fs.statSync(latestFile).mtimeMs : 0

    projects.push({
      dir,
      name: resolveProjectName(dir),
      sessions: files.length,
      totalTokens: allTokens,
      windowTokens,
      lastActive,
    })
  }

  // Sort by most recently active
  projects.sort((a, b) => b.lastActive - a.lastActive)

  // Column widths
  const nameWidth = Math.min(50, Math.max(20, ...projects.map(p => p.name.length + 2)))
  const showQuota = limit !== null

  // Header
  const header =
    'Project'.padEnd(nameWidth) +
    'Sessions'.padStart(9) +
    'Win out-tok'.padStart(12) +
    (showQuota ? '  Quota'.padStart(16) : '') +
    'All billing-tok'.padStart(16) +
    'Last active'.padStart(14)
  console.log(header)
  console.log('─'.repeat(header.replace(/\x1b\[[0-9;]*m/g, '').length))

  for (const p of projects) {
    const age = p.lastActive > 0 ? formatAge(Date.now() - p.lastActive) : '—'
    const pct = limit ? Math.min(100, Math.round((p.windowTokens / limit) * 100)) : 0
    const quotaCol = showQuota
      ? `  ${quotaBar(pct)} ${String(pct + '%').padStart(4)}`
      : ''

    console.log(
      p.name.slice(0, nameWidth - 2).padEnd(nameWidth) +
      String(p.sessions).padStart(9) +
      p.windowTokens.toLocaleString().padStart(12) +
      quotaCol +
      p.totalTokens.toLocaleString().padStart(16) +
      age.padStart(14)
    )

    // --detail: expand each session within the project
    if (opts.detail) {
      const files = findSessionFiles(p.dir)
      for (const file of files) {
        const turns = parseSessionFile(file)
        const sessionOutputTokens = sumOutputTokens(turns.filter(t => !t.isSidechain))
        const sessionBillingTokens = turns.reduce((s, t) => s + t.usage.total, 0)
        const sessionAge = fs.statSync(file).mtimeMs
        const stem = path.basename(file, '.jsonl')
        const shortId = stem.slice(0, 8) + '…'
        const sessionPct = limit ? Math.min(100, Math.round((sessionOutputTokens / limit) * 100)) : null
        const pctStr = sessionPct !== null ? ` (${sessionPct}% quota)` : ''
        console.log(
          `  ↳ ${shortId}  ${sessionBillingTokens.toLocaleString().padStart(12)} billing-tok  ${sessionOutputTokens.toLocaleString().padStart(8)} out-tok${pctStr}  ${formatAge(Date.now() - sessionAge).padStart(12)}`
        )
      }
    }
  }

  console.log()
  console.log(`Total projects: ${projects.length}  │  Plan: ${config.plan.toUpperCase()}${limit ? ` (${(limit / 1000).toFixed(0)}k limit)` : ' (no limit)'}`)
  if (opts.detail) {
    console.log(`Tip: use the full session UUID with: claude-token-lens report --session <uuid>`)
  } else {
    console.log(`Tip: run \`claude-token-lens sessions --detail\` to see individual sessions.`)
    console.log(`     run \`claude-token-lens live\` from inside a project to watch live.`)
  }
}

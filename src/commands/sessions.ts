import { listProjectDirs, findSessionFiles, resolveProjectName } from '../lib/paths.js'
import { parseProject } from '../lib/parser.js'
import { filterRollingWindow } from '../lib/quota.js'
import * as fs from 'fs'

function formatAge(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function sessionsCommand(): void {
  const dirs = listProjectDirs()

  if (dirs.length === 0) {
    console.log('No Claude Code projects found.')
    console.log(`Expected: ~/.claude/projects/`)
    return
  }

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

    const turns = parseProject(dir)
    const windowed = filterRollingWindow(turns.filter(t => !t.isSidechain))
    const allTokens = turns.reduce((s, t) => s + t.usage.total, 0)
    const windowTokens = windowed.reduce((s, t) => s + t.usage.total, 0)

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

  // Header
  const nameWidth = Math.min(50, Math.max(20, ...projects.map(p => p.name.length + 2)))
  console.log(
    'Project'.padEnd(nameWidth) +
    'Sessions'.padStart(9) +
    'Window tok'.padStart(12) +
    'All-time tok'.padStart(14) +
    'Last active'.padStart(14)
  )
  console.log('─'.repeat(nameWidth + 9 + 12 + 14 + 14))

  for (const p of projects) {
    const age = p.lastActive > 0 ? formatAge(Date.now() - p.lastActive) : '—'
    console.log(
      p.name.slice(0, nameWidth - 2).padEnd(nameWidth) +
      String(p.sessions).padStart(9) +
      p.windowTokens.toLocaleString().padStart(12) +
      p.totalTokens.toLocaleString().padStart(14) +
      age.padStart(14)
    )
  }

  console.log()
  console.log(`Total projects: ${projects.length}`)
  console.log(`Tip: run \`claude-token-lens live\` from inside a project directory to watch live.`)
}

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

function shortenHome(p: string): string {
  const home = os.homedir()
  return p.startsWith(home) ? '~' + p.slice(home.length) : p
}

/** Resolve a human-readable project name from the project directory.
 *
 *  Strategy (in order):
 *  1. Read `cwd` / `projectPath` / `path` from Claude's metadata files
 *  2. Scan the first 20 lines of the newest session JSONL for a `cwd` field
 *     (Claude Code writes cwd into each turn line)
 *  3. Last resort: slug conversion — hyphens are ambiguous with path separators
 *     so this will mangle paths like `my-project`, but it's better than nothing.
 */
export function resolveProjectName(projectDir: string): string {
  // 1. Metadata files
  for (const candidate of ['settings.json', '.metadata.json', 'metadata.json']) {
    try {
      const p = path.join(projectDir, candidate)
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>
        const cwd = data['cwd'] ?? data['projectPath'] ?? data['path']
        if (typeof cwd === 'string' && cwd.length > 0) return shortenHome(cwd)
      }
    } catch { /* continue */ }
  }

  // 2. First 20 lines of newest session file
  const files = findSessionFiles(projectDir)
  if (files.length > 0) {
    try {
      const lines = fs.readFileSync(files[0]!, 'utf8').split('\n').slice(0, 20)
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line) as Record<string, unknown>
          const cwd = obj['cwd']
          if (typeof cwd === 'string' && cwd.length > 0) return shortenHome(cwd)
        } catch { /* continue */ }
      }
    } catch { /* continue */ }
  }

  // 3. Slug fallback (ambiguous — hyphens in dir name look identical to path separators)
  const slug = path.basename(projectDir)
  const converted = slug.replace(/^-/, '').replace(/-/g, '/')
  if (converted.startsWith('Users/')) {
    return '~/' + converted.split('/').slice(2).join('/')
  }
  return converted || slug
}

export function getClaudeProjectsDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, 'Claude', 'projects')
  }
  return path.join(os.homedir(), '.claude', 'projects')
}

export function listProjectDirs(): string[] {
  const base = getClaudeProjectsDir()
  if (!fs.existsSync(base)) return []
  return fs.readdirSync(base)
    .map(d => path.join(base, d))
    .filter(d => fs.statSync(d).isDirectory())
}

export function findSessionFiles(projectDir: string): string[] {
  if (!fs.existsSync(projectDir)) return []
  return fs.readdirSync(projectDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => path.join(projectDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
}

export function getLatestSession(projectDir?: string): string | null {
  const dir = projectDir ?? detectCurrentProjectDir()
  if (!dir) return null
  const files = findSessionFiles(dir)
  return files[0] ?? null
}

export function detectCurrentProjectDir(): string | null {
  const base = getClaudeProjectsDir()
  if (!fs.existsSync(base)) return null
  // Find project dir matching cwd slug
  const cwd = process.cwd()
  const slug = '-' + cwd.replace(/\//g, '-').replace(/\\/g, '-').replace(/^-+/, '')
  const direct = path.join(base, slug)
  if (fs.existsSync(direct)) return direct
  // Fallback: most recently modified project
  const dirs = listProjectDirs()
  if (dirs.length === 0) return null
  return dirs.sort((a, b) => {
    const aFiles = findSessionFiles(a)
    const bFiles = findSessionFiles(b)
    const aTime = aFiles[0] ? fs.statSync(aFiles[0]).mtimeMs : 0
    const bTime = bFiles[0] ? fs.statSync(bFiles[0]).mtimeMs : 0
    return bTime - aTime
  })[0] ?? null
}

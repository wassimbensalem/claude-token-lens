import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/** Resolve a human-readable project name from the project directory.
 *  Prefers reading the real cwd from Claude's project metadata.
 *  Falls back to slug-based conversion (hyphens are ambiguous with slashes).
 */
export function resolveProjectName(projectDir: string): string {
  // Try to read real path from Claude's project metadata
  // Claude Code stores cwd in the project's settings file
  for (const candidate of ['settings.json', '.metadata.json', 'metadata.json']) {
    const p = path.join(projectDir, candidate)
    try {
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>
        const cwd = data['cwd'] ?? data['projectPath'] ?? data['path']
        if (typeof cwd === 'string' && cwd.length > 0) {
          const home = os.homedir()
          return cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd
        }
      }
    } catch { /* continue */ }
  }
  // Fallback: slug conversion (hyphens → slashes, ambiguous but best effort)
  const slug = path.basename(projectDir)
  const p = slug.replace(/^-/, '').replace(/-/g, '/')
  if (p.startsWith('Users/')) {
    const parts = p.split('/')
    return '~/' + parts.slice(2).join('/')
  }
  return p || slug
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

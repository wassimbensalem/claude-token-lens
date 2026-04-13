import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

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

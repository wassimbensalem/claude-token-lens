import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

function shortenHome(p: string): string {
  const home = os.homedir()
  return p.startsWith(home) ? '~' + p.slice(home.length) : p
}

/**
 * Reconstruct an absolute path from a Claude project slug by walking the
 * filesystem. The slug encodes a path as a leading hyphen followed by
 * path components joined with hyphens — but since directory names can also
 * contain hyphens, reversing it naively is ambiguous.
 *
 * This function resolves the ambiguity greedily: starting from the known
 * home-directory prefix, it tries the longest hyphen-joined token sequence
 * that matches an existing directory, then advances past it.
 *
 * Example:
 *   slug  → -Users-wassim-Desktop-Projects-Extra-claude-token-lens
 *   result → /Users/wassim/Desktop/Projects-Extra/claude-token-lens
 */
function slugToAbsPath(slug: string): string | null {
  const home = os.homedir()
  // Slug always starts with a leading hyphen; strip it
  let remaining = slug.replace(/^-/, '')

  // Normalise home to forward slashes and strip Windows drive letter so that
  // C:\Users\NAME → Users-NAME (same slug form as macOS /Users/name → Users-name).
  const normalizedHome = home.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  const homeSlug = normalizedHome.replace(/^\//, '').replace(/\//g, '-')
  if (!remaining.startsWith(homeSlug)) return null

  remaining = remaining.slice(homeSlug.length)
  if (remaining.startsWith('-')) remaining = remaining.slice(1)
  if (!remaining) return home

  const parts = remaining.split('-')
  let currentPath = home
  let i = 0

  while (i < parts.length) {
    // Try longest match first (greedy), shrink if the directory doesn't exist
    let matched = false
    for (let len = parts.length - i; len >= 1; len--) {
      const segment = parts.slice(i, i + len).join('-')
      const candidate = path.join(currentPath, segment)
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
          currentPath = candidate
          i += len
          matched = true
          break
        }
      } catch { /* skip inaccessible paths */ }
    }
    if (!matched) {
      // Remaining segments couldn't be matched — append as-is (best effort)
      currentPath = path.join(currentPath, parts.slice(i).join('-'))
      break
    }
  }

  return currentPath
}

/** Resolve a human-readable project name from the project directory.
 *
 *  Strategy (in order):
 *  1. Read `cwd` / `projectPath` / `path` from Claude's metadata files
 *  2. Scan the first 20 lines of the newest session JSONL for a `cwd` field
 *  3. Walk the filesystem to reconstruct the real path from the slug,
 *     resolving the hyphen ambiguity by checking which directories exist
 *  4. Last resort: naive slug-to-path conversion (will mangle hyphenated names)
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

  // 3. Filesystem walk — resolve ambiguous hyphens by checking real dirs
  const slug = path.basename(projectDir)
  const walked = slugToAbsPath(slug)
  if (walked) return shortenHome(walked)

  // 4. Naive fallback
  const converted = slug.replace(/^-/, '').replace(/-/g, '/')
  if (converted.startsWith('Users/')) {
    return '~/' + converted.split('/').slice(2).join('/')
  }
  return converted || slug
}

export function getClaudeProjectsDir(): string {
  // Claude Code is a Node.js CLI and stores sessions in ~/.claude/projects on
  // all platforms — including Windows (resolves to C:\Users\NAME\.claude\projects).
  // AppData\Roaming is for native Windows GUI apps (Electron), not Node.js CLIs.
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
  // Normalise cwd to forward slashes and strip Windows drive letter (C: → '')
  // so that C:\Users\NAME\project → /Users/NAME/project → -Users-NAME-project,
  // matching the slug format Claude Code writes on all platforms.
  const cwd = process.cwd().replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  const slug = '-' + cwd.replace(/^\//, '').replace(/\//g, '-')
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

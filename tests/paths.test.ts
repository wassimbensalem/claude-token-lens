import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { resolveProjectName, findSessionFiles } from '../src/lib/paths.js'

// Helper: create a temp dir tree and return the root
function makeTempDir(...segments: string[]): string {
  let current = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl-paths-'))
  for (const seg of segments) {
    current = path.join(current, seg)
    fs.mkdirSync(current, { recursive: true })
  }
  return current
}

// Helper: write a minimal .jsonl with a cwd field in the first line
function writeJsonlWithCwd(dir: string, filename: string, cwd: string): string {
  const file = path.join(dir, filename)
  fs.writeFileSync(file, JSON.stringify({ cwd, type: 'attachment', sessionId: 'x' }) + '\n', 'utf8')
  return file
}

// Helper: write a settings.json with cwd
function writeSettings(dir: string, cwd: string): void {
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ cwd }), 'utf8')
}

describe('resolveProjectName', () => {
  it('reads cwd from settings.json when present', () => {
    const dir = makeTempDir()
    writeSettings(dir, '/Users/test/my-project')
    expect(resolveProjectName(dir)).toBe('/Users/test/my-project')
  })

  it('shortens home dir to ~ in resolved path', () => {
    const dir = makeTempDir()
    const home = os.homedir()
    writeSettings(dir, path.join(home, 'Desktop', 'my-project'))
    const result = resolveProjectName(dir)
    expect(result.startsWith('~')).toBe(true)
    expect(result).toBe(`~/Desktop/my-project`)
  })

  it('reads cwd from first 20 lines of newest .jsonl when no settings.json', () => {
    const dir = makeTempDir()
    writeJsonlWithCwd(dir, 'session.jsonl', '/Users/test/from-jsonl')
    expect(resolveProjectName(dir)).toBe('/Users/test/from-jsonl')
  })

  it('prefers settings.json over .jsonl cwd', () => {
    const dir = makeTempDir()
    writeSettings(dir, '/from/settings')
    writeJsonlWithCwd(dir, 'session.jsonl', '/from/jsonl')
    expect(resolveProjectName(dir)).toBe('/from/settings')
  })

  it('falls back to slug-based resolution when no metadata or jsonl cwd', () => {
    // No settings.json, no jsonl with cwd — should return something non-empty
    const dir = makeTempDir()
    const result = resolveProjectName(dir)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('findSessionFiles', () => {
  it('returns only .jsonl files, sorted by mtime descending', () => {
    const dir = makeTempDir()
    const a = path.join(dir, 'a.jsonl')
    const b = path.join(dir, 'b.jsonl')
    const txt = path.join(dir, 'notes.txt')
    fs.writeFileSync(a, '', 'utf8')
    // Small delay to ensure different mtime
    fs.writeFileSync(b, '', 'utf8')
    fs.writeFileSync(txt, 'ignore me', 'utf8')
    // Touch b to make it newer
    const now = new Date()
    fs.utimesSync(a, now, new Date(now.getTime() - 5000))
    fs.utimesSync(b, now, now)
    const files = findSessionFiles(dir)
    expect(files.every(f => f.endsWith('.jsonl'))).toBe(true)
    expect(files).toHaveLength(2)
    // b is newer so should come first
    expect(path.basename(files[0]!)).toBe('b.jsonl')
    expect(path.basename(files[1]!)).toBe('a.jsonl')
  })

  it('returns empty array for missing directory', () => {
    expect(findSessionFiles('/tmp/does-not-exist-ctl-paths')).toEqual([])
  })

  it('returns empty array for directory with no .jsonl files', () => {
    const dir = makeTempDir()
    fs.writeFileSync(path.join(dir, 'notes.txt'), '', 'utf8')
    expect(findSessionFiles(dir)).toEqual([])
  })
})

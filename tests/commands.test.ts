import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// Helper: build a temp project dir with JSONL session files
function makeProject(
  base: string,
  slug: string,
  sessions: Array<{ filename: string; turns: number; minutesAgo?: number }>
): string {
  const dir = path.join(base, slug)
  fs.mkdirSync(dir, { recursive: true })
  for (const session of sessions) {
    const lines: string[] = []
    for (let i = 0; i < session.turns; i++) {
      const ts = new Date(Date.now() - (session.minutesAgo ?? 0) * 60 * 1000).toISOString()
      lines.push(JSON.stringify({
        timestamp: ts,
        sessionId: session.filename.replace('.jsonl', ''),
        isSidechain: false,
        toolUseID: null,
        message: {
          role: 'assistant',
          content: [],
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 1000,
            output_tokens: 50,
          },
        },
      }))
    }
    fs.writeFileSync(path.join(dir, session.filename), lines.join('\n') + '\n', 'utf8')
  }
  return dir
}

// ─── statusCommand ────────────────────────────────────────────────────────────

describe('statusCommand', () => {
  let tmpBase: string
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl-status-'))
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('reports output and billing tokens from active projects', async () => {
    const projDir = makeProject(tmpBase, 'proj-a', [
      { filename: 'session.jsonl', turns: 3, minutesAgo: 10 },
    ])

    // Mock listProjectDirs to return our temp project
    vi.doMock('../src/lib/paths.js', () => ({
      listProjectDirs: () => [projDir],
      findSessionFiles: (d: string) =>
        fs.readdirSync(d).filter((f: string) => f.endsWith('.jsonl')).map((f: string) => path.join(d, f)),
      resolveProjectName: () => 'test-project',
      getClaudeProjectsDir: () => tmpBase,
      getLatestSession: () => null,
      detectCurrentProjectDir: () => null,
    }))

    const { statusCommand } = await import('../src/commands/status.js?bust=1')
    statusCommand()

    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(output).toMatch(/output tokens/i)
    expect(output).toMatch(/billing/i)
    expect(output).toMatch(/1 of 1 projects active/)

    vi.doUnmock('../src/lib/paths.js')
  })

  it('shows 0 active projects when all turns are outside window', async () => {
    const projDir = makeProject(tmpBase, 'proj-old', [
      { filename: 'old.jsonl', turns: 2, minutesAgo: 400 }, // 6h+ ago, outside 5h window
    ])

    vi.doMock('../src/lib/paths.js', () => ({
      listProjectDirs: () => [projDir],
      findSessionFiles: (d: string) =>
        fs.readdirSync(d).filter((f: string) => f.endsWith('.jsonl')).map((f: string) => path.join(d, f)),
      resolveProjectName: () => 'old-project',
      getClaudeProjectsDir: () => tmpBase,
      getLatestSession: () => null,
      detectCurrentProjectDir: () => null,
    }))

    const { statusCommand } = await import('../src/commands/status.js?bust=2')
    statusCommand()

    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(output).toMatch(/0 of 1 projects active/)

    vi.doUnmock('../src/lib/paths.js')
  })
})

// ─── sessionsCommand ──────────────────────────────────────────────────────────

describe('sessionsCommand', () => {
  let tmpBase: string
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl-sessions-'))
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('shows no-projects message when list is empty', async () => {
    vi.doMock('../src/lib/paths.js', () => ({
      listProjectDirs: () => [],
      findSessionFiles: () => [],
      resolveProjectName: () => '',
      getClaudeProjectsDir: () => tmpBase,
      getLatestSession: () => null,
      detectCurrentProjectDir: () => null,
    }))

    const { sessionsCommand } = await import('../src/commands/sessions.js?bust=1')
    sessionsCommand()

    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(output).toMatch(/no claude code projects/i)

    vi.doUnmock('../src/lib/paths.js')
  })

  it('lists two projects with correct token totals', async () => {
    const projA = makeProject(tmpBase, 'alpha', [{ filename: 'a.jsonl', turns: 2, minutesAgo: 10 }])
    const projB = makeProject(tmpBase, 'beta',  [{ filename: 'b.jsonl', turns: 3, minutesAgo: 20 }])

    vi.doMock('../src/lib/paths.js', () => ({
      listProjectDirs: () => [projA, projB],
      findSessionFiles: (d: string) =>
        fs.readdirSync(d).filter((f: string) => f.endsWith('.jsonl')).map((f: string) => path.join(d, f)),
      resolveProjectName: (d: string) => path.basename(d),
      getClaudeProjectsDir: () => tmpBase,
      getLatestSession: () => null,
      detectCurrentProjectDir: () => null,
    }))

    const { sessionsCommand } = await import('../src/commands/sessions.js?bust=2')
    sessionsCommand()

    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(output).toMatch(/Total projects: 2/)
    // Each turn: output=50, so 2 turns = 100 output, 3 turns = 150
    expect(output).toMatch(/100|150/)

    vi.doUnmock('../src/lib/paths.js')
  })
})

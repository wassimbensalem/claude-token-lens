import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { parseSessionFile, parseProject } from '../src/lib/parser.js'

// Helper: write a temp JSONL file, return its path
function writeTempJsonl(lines: object[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl-test-'))
  const file = path.join(dir, 'session.jsonl')
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n'), 'utf8')
  return file
}

function assistantTurn(overrides: {
  input?: number
  cacheCreation?: number
  cacheRead?: number
  output?: number
  content?: unknown[]
  isSidechain?: boolean
  parentToolUseID?: string | null
  toolUseID?: string | null
  timestamp?: string
}) {
  return {
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    sessionId: 'test-session',
    isSidechain: overrides.isSidechain ?? false,
    parentToolUseID: overrides.parentToolUseID ?? null,
    toolUseID: overrides.toolUseID ?? null,
    message: {
      role: 'assistant',
      content: overrides.content ?? [],
      usage: {
        input_tokens: overrides.input ?? 0,
        cache_creation_input_tokens: overrides.cacheCreation ?? 0,
        cache_read_input_tokens: overrides.cacheRead ?? 0,
        output_tokens: overrides.output ?? 0,
      },
    },
  }
}

describe('parseUsage — token accounting', () => {
  it('computes total as input + cacheCreation + output (excludes cacheRead)', () => {
    const file = writeTempJsonl([
      assistantTurn({ input: 1000, cacheCreation: 500, cacheRead: 50000, output: 200 }),
    ])
    const turns = parseSessionFile(file)
    expect(turns).toHaveLength(1)
    expect(turns[0]!.usage.total).toBe(1000 + 500 + 200) // 1700
  })

  it('computes billingTotal as total + round(cacheRead × 0.1)', () => {
    const file = writeTempJsonl([
      assistantTurn({ input: 1000, cacheCreation: 500, cacheRead: 50000, output: 200 }),
    ])
    const turns = parseSessionFile(file)
    const u = turns[0]!.usage
    // billingTotal = 1700 + round(50000 * 0.1) = 1700 + 5000 = 6700
    expect(u.billingTotal).toBe(6700)
  })

  it('rounds cacheRead × 0.1 correctly — fractional tokens', () => {
    // cacheRead = 5 → 5 * 0.1 = 0.5 → rounds to 1
    const file = writeTempJsonl([
      assistantTurn({ input: 100, cacheCreation: 0, cacheRead: 5, output: 50 }),
    ])
    const turns = parseSessionFile(file)
    const u = turns[0]!.usage
    expect(u.total).toBe(150)
    expect(u.billingTotal).toBe(150 + Math.round(5 * 0.1)) // 151
  })

  it('handles zero usage gracefully', () => {
    const file = writeTempJsonl([
      assistantTurn({ input: 0, cacheCreation: 0, cacheRead: 0, output: 0 }),
    ])
    const turns = parseSessionFile(file)
    expect(turns[0]!.usage).toEqual({
      input: 0,
      cacheCreation: 0,
      cacheRead: 0,
      output: 0,
      total: 0,
      billingTotal: 0,
    })
  })

  it('exposes all individual fields correctly', () => {
    const file = writeTempJsonl([
      assistantTurn({ input: 100, cacheCreation: 200, cacheRead: 300, output: 400 }),
    ])
    const turns = parseSessionFile(file)
    const u = turns[0]!.usage
    expect(u.input).toBe(100)
    expect(u.cacheCreation).toBe(200)
    expect(u.cacheRead).toBe(300)
    expect(u.output).toBe(400)
  })
})

describe('parseSessionFile — filtering', () => {
  it('skips non-assistant messages', () => {
    const file = writeTempJsonl([
      { timestamp: new Date().toISOString(), sessionId: 's', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
      assistantTurn({ output: 100 }),
    ])
    const turns = parseSessionFile(file)
    expect(turns).toHaveLength(1)
  })

  it('skips messages with no usage field', () => {
    const file = writeTempJsonl([
      { timestamp: new Date().toISOString(), sessionId: 's', message: { role: 'assistant', content: [] } },
      assistantTurn({ output: 50 }),
    ])
    const turns = parseSessionFile(file)
    expect(turns).toHaveLength(1)
  })

  it('skips malformed JSON lines without throwing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl-test-'))
    const file = path.join(dir, 'broken.jsonl')
    const goodLine = JSON.stringify(assistantTurn({ output: 10 }))
    fs.writeFileSync(file, `{broken json\n${goodLine}\n{also broken`, 'utf8')
    const turns = parseSessionFile(file)
    expect(turns).toHaveLength(1)
    expect(turns[0]!.usage.output).toBe(10)
  })

  it('returns empty array for non-existent file', () => {
    expect(parseSessionFile('/tmp/does-not-exist.jsonl')).toEqual([])
  })

  it('preserves isSidechain flag', () => {
    const file = writeTempJsonl([
      assistantTurn({ output: 100, isSidechain: true }),
      assistantTurn({ output: 50, isSidechain: false }),
    ])
    const turns = parseSessionFile(file)
    expect(turns[0]!.isSidechain).toBe(true)
    expect(turns[1]!.isSidechain).toBe(false)
  })
})

describe('parseProject', () => {
  it('aggregates turns across multiple .jsonl files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl-test-'))
    fs.writeFileSync(
      path.join(dir, 'a.jsonl'),
      JSON.stringify(assistantTurn({ output: 100 })) + '\n',
      'utf8'
    )
    fs.writeFileSync(
      path.join(dir, 'b.jsonl'),
      JSON.stringify(assistantTurn({ output: 200 })) + '\n' +
      JSON.stringify(assistantTurn({ output: 300 })) + '\n',
      'utf8'
    )
    const turns = parseProject(dir)
    expect(turns).toHaveLength(3)
  })

  it('ignores non-.jsonl files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl-test-'))
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello', 'utf8')
    fs.writeFileSync(
      path.join(dir, 'session.jsonl'),
      JSON.stringify(assistantTurn({ output: 50 })) + '\n',
      'utf8'
    )
    const turns = parseProject(dir)
    expect(turns).toHaveLength(1)
  })

  it('returns empty array for missing directory', () => {
    expect(parseProject('/tmp/definitely-missing-dir-ctl')).toEqual([])
  })
})

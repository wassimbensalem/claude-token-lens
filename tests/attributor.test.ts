import { describe, it, expect } from 'vitest'
import { attributeLabel, buildAttribution } from '../src/lib/attributor.js'
import type { Turn } from '../src/lib/parser.js'

// Helper: build a minimal content array
function makeContent(items: Array<
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input?: Record<string, unknown> }
>): unknown[] {
  return items as unknown[]
}

// Helper: build a minimal Turn for buildAttribution
function makeTurn(label: string, tokens: Partial<{ input: number; cacheCreation: number; cacheRead: number; output: number }> = {}): Turn {
  const input = tokens.input ?? 0
  const cacheCreation = tokens.cacheCreation ?? 0
  const cacheRead = tokens.cacheRead ?? 0
  const output = tokens.output ?? 0
  const total = input + cacheCreation + output
  return {
    timestamp: new Date(),
    sessionId: 'test',
    filePath: '/test.jsonl',
    usage: { input, cacheCreation, cacheRead, output, total, billingTotal: total + Math.round(cacheRead * 0.1) },
    label,
    isSidechain: false,
    parentToolUseID: null,
    toolUseID: null,
  }
}

describe('attributeLabel — MCP (tier 1)', () => {
  it('labels mcp__ tools with "mcp: server/method" format', () => {
    const content = makeContent([{ type: 'tool_use', name: 'mcp__context7__resolve', input: {} }])
    expect(attributeLabel(content)).toBe('mcp: context7/resolve')
  })

  it('converts double underscores to slashes in mcp labels', () => {
    const content = makeContent([{ type: 'tool_use', name: 'mcp__my_server__my_tool', input: {} }])
    expect(attributeLabel(content)).toBe('mcp: my_server/my_tool')
  })

  it('prefers mcp over other tools when both present', () => {
    const content = makeContent([
      { type: 'tool_use', name: 'Read', input: {} },
      { type: 'tool_use', name: 'mcp__figma__get_design', input: {} },
    ])
    expect(attributeLabel(content)).toMatch(/^mcp:/)
  })
})

describe('attributeLabel — Agent (tier 2)', () => {
  it('uses subagent_type as stable label key', () => {
    const content = makeContent([{
      type: 'tool_use',
      name: 'Agent',
      input: { subagent_type: 'lead-engineer', description: 'Implement the feature' },
    }])
    expect(attributeLabel(content)).toBe('agent: lead-engineer')
  })

  it('two Agent calls with same subagent_type produce the same label', () => {
    const content1 = makeContent([{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'qa-tester', description: 'First test run' } }])
    const content2 = makeContent([{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'qa-tester', description: 'Second test run' } }])
    expect(attributeLabel(content1)).toBe(attributeLabel(content2))
  })

  it('falls back to truncated description if no subagent_type', () => {
    const desc = 'A very long description that exceeds thirty characters easily'
    const content = makeContent([{ type: 'tool_use', name: 'Agent', input: { description: desc } }])
    const label = attributeLabel(content)
    expect(label).toMatch(/^agent: /)
    expect(label.length).toBeLessThanOrEqual('agent: '.length + 31) // 30 chars + optional ellipsis
  })

  it('uses "agent" as fallback when both subagent_type and description are absent', () => {
    const content = makeContent([{ type: 'tool_use', name: 'Agent', input: {} }])
    expect(attributeLabel(content)).toBe('agent: agent')
  })
})

describe('attributeLabel — Skill (tier 3)', () => {
  it('extracts skill name from "Skill: /investigate" annotation', () => {
    const content = makeContent([{ type: 'text', text: 'Skill: /investigate — looking into the bug' }])
    expect(attributeLabel(content)).toBe('skill: /investigate')
  })

  it('stops at backtick: "Skill: `/review`" → "/review" not "/review`"', () => {
    const content = makeContent([{ type: 'text', text: 'Skill: `/review` — checking code quality' }])
    expect(attributeLabel(content)).toBe('skill: /review')
  })

  it('stops at em-dash: "Skill: /plan — reason" → "/plan"', () => {
    const content = makeContent([{ type: 'text', text: 'Skill: /plan — planning the approach' }])
    expect(attributeLabel(content)).toBe('skill: /plan')
  })

  it('stops at space: "Skill: /debug something" → "/debug"', () => {
    const content = makeContent([{ type: 'text', text: 'Skill: /debug something else' }])
    expect(attributeLabel(content)).toBe('skill: /debug')
  })
})

describe('attributeLabel — Tools (tier 4)', () => {
  it('labels single tool use', () => {
    const content = makeContent([{ type: 'tool_use', name: 'Read', input: {} }])
    expect(attributeLabel(content)).toBe('tool: Read')
  })

  it('shows up to 2 unique tool names', () => {
    const content = makeContent([
      { type: 'tool_use', name: 'Read', input: {} },
      { type: 'tool_use', name: 'Grep', input: {} },
      { type: 'tool_use', name: 'Read', input: {} }, // duplicate — should deduplicate
    ])
    expect(attributeLabel(content)).toBe('tool: Read, Grep')
  })

  it('deduplicates repeated calls to the same tool', () => {
    const content = makeContent([
      { type: 'tool_use', name: 'Bash', input: {} },
      { type: 'tool_use', name: 'Bash', input: {} },
      { type: 'tool_use', name: 'Bash', input: {} },
    ])
    expect(attributeLabel(content)).toBe('tool: Bash')
  })
})

describe('attributeLabel — Direct (tier 5)', () => {
  it('returns [direct] for empty content', () => {
    expect(attributeLabel([])).toBe('[direct]')
  })

  it('returns [direct] for text-only content with no skill annotation', () => {
    const content = makeContent([{ type: 'text', text: 'Here is my response.' }])
    expect(attributeLabel(content)).toBe('[direct]')
  })

  it('returns [direct] for non-array content', () => {
    expect(attributeLabel(null as unknown as unknown[])).toBe('[direct]')
    expect(attributeLabel('string' as unknown as unknown[])).toBe('[direct]')
  })
})

describe('buildAttribution', () => {
  it('aggregates turns with the same label', () => {
    const turns = [
      makeTurn('tool: Read', { input: 100, output: 50 }),
      makeTurn('tool: Read', { input: 200, output: 100 }),
    ]
    const result = buildAttribution(turns)
    expect(result).toHaveLength(1)
    expect(result[0]!.label).toBe('tool: Read')
    expect(result[0]!.tokens).toBe(450) // (100+50) + (200+100)
    expect(result[0]!.turnCount).toBe(2)
  })

  it('keeps different labels as separate rows', () => {
    const turns = [
      makeTurn('tool: Read', { output: 100 }),
      makeTurn('agent: lead-engineer', { output: 200 }),
      makeTurn('mcp: figma/get', { output: 50 }),
    ]
    const result = buildAttribution(turns)
    expect(result).toHaveLength(3)
  })

  it('sorts by tokens descending', () => {
    const turns = [
      makeTurn('small', { output: 10 }),
      makeTurn('huge', { output: 1000 }),
      makeTurn('medium', { output: 100 }),
    ]
    const result = buildAttribution(turns)
    expect(result[0]!.label).toBe('huge')
    expect(result[1]!.label).toBe('medium')
    expect(result[2]!.label).toBe('small')
  })

  it('returns empty array for no turns', () => {
    expect(buildAttribution([])).toEqual([])
  })

  it('billingTokens field aggregates correctly', () => {
    const turns = [
      makeTurn('tool: Bash', { input: 100, cacheRead: 1000, output: 50 }),
      makeTurn('tool: Bash', { input: 200, cacheRead: 2000, output: 100 }),
    ]
    const result = buildAttribution(turns)
    // billingTotal per turn = total + round(cacheRead * 0.1)
    // turn1: total=150, billing=150+100=250
    // turn2: total=300, billing=300+200=500
    expect(result[0]!.billingTokens).toBe(750)
  })
})

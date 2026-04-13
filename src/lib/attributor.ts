import type { Turn } from './parser.js'

export function attributeLabel(content: unknown[]): string {
  if (!Array.isArray(content)) return '[direct]'

  const toolUses = content.filter(
    (c): c is { type: string; name: string; input: Record<string, unknown> } =>
      typeof c === 'object' && c !== null && (c as Record<string, unknown>)['type'] === 'tool_use'
  )

  const texts = content
    .filter((c): c is { type: string; text: string } =>
      typeof c === 'object' && c !== null && (c as Record<string, unknown>)['type'] === 'text'
    )
    .map(c => c.text ?? '')
    .join(' ')

  // 1. MCP tool
  const mcpTool = toolUses.find(t => t.name.startsWith('mcp__'))
  if (mcpTool) {
    const label = mcpTool.name.replace(/^mcp__/, '').replace(/__/g, '/')
    return `mcp: ${label}`
  }

  // 2. Agent — use subagent_type as stable label so all calls of the same role
  //    aggregate into one row rather than splitting by description text
  const agentTool = toolUses.find(t => t.name === 'Agent')
  if (agentTool) {
    const subtype = agentTool.input['subagent_type']
    if (typeof subtype === 'string' && subtype.length > 0) {
      return `agent: ${subtype}`
    }
    // fallback: first 30 chars of description (stable-ish for dedup)
    const desc = String(agentTool.input['description'] ?? 'agent')
    return `agent: ${desc.slice(0, 30)}${desc.length > 30 ? '…' : ''}`
  }

  // 3. Skill — require an em-dash or " — " after the skill name so that
  //    explanatory text ("the regex requires `Skill: /name`") doesn't false-positive.
  //    Real announcements always follow: "Skill: `/name` — reason" or "Skill: /name — reason"
  const skillMatch = texts.match(/Skill:\s*`?(\/[^\s`—\u2014]+)[`\s]*(?:—|\u2014| — )/)
  if (skillMatch) {
    return `skill: ${skillMatch[1]}`
  }

  // 4. Other tools (show up to 2 unique names)
  if (toolUses.length > 0) {
    const names = [...new Set(toolUses.map(t => t.name))].slice(0, 2)
    return `tool: ${names.join(', ')}`
  }

  // 5. Direct response — no tool calls, no skill annotation
  return '[direct]'
}

export interface Attribution {
  label: string
  /** Generation cost: input + cacheCreation + output. Comparable across sources. */
  tokens: number
  /** Billing-weighted cost including cacheRead×0.1. Aggregate only — not per-source. */
  billingTokens: number
  input: number
  cacheCreation: number
  cacheRead: number
  output: number
  turnCount: number
}

export function buildAttribution(turns: Turn[]): Attribution[] {
  const map = new Map<string, Attribution>()

  for (const turn of turns) {
    const existing = map.get(turn.label)
    if (existing) {
      existing.tokens += turn.usage.total
      existing.billingTokens += turn.usage.billingTotal
      existing.input += turn.usage.input
      existing.cacheCreation += turn.usage.cacheCreation
      existing.cacheRead += turn.usage.cacheRead
      existing.output += turn.usage.output
      existing.turnCount += 1
    } else {
      map.set(turn.label, {
        label: turn.label,
        tokens: turn.usage.total,
        billingTokens: turn.usage.billingTotal,
        input: turn.usage.input,
        cacheCreation: turn.usage.cacheCreation,
        cacheRead: turn.usage.cacheRead,
        output: turn.usage.output,
        turnCount: 1,
      })
    }
  }

  return Array.from(map.values()).sort((a, b) => b.tokens - a.tokens)
}

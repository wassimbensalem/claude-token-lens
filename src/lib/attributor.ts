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

  // 3. Skill tool call — extract name directly from the tool input.
  //    Takes priority over the text-annotation path below so that a turn with
  //    both a Skill tool_use AND an announcement text doesn't produce two rows.
  //    Real input shape: { skill: "gstack-investigate" } or { name: "/investigate" }
  const skillTool = toolUses.find(t => t.name === 'Skill')
  if (skillTool) {
    const name = skillTool.input['skill'] ?? skillTool.input['name'] ?? 'unknown'
    return `skill: ${String(name)}`
  }

  // 3b. Skill text annotation — for turns where Claude announces a skill in text
  //     but doesn't call the Skill tool (e.g. some skill invocation styles).
  //     Require an em-dash after the skill name to avoid false positives from
  //     explanatory text like "the regex requires `Skill: /name`".
  const skillMatch = texts.match(/Skill:\s*`?(\/[^\s`—\u2014]+)[`\s]*(?:—|\u2014| — )/)
  if (skillMatch) {
    return `skill: ${skillMatch[1]}`
  }

  // 4. Other tools — in practice content[] always contains exactly one tool_use
  //    (Claude Code writes one tool call per JSONL line), so this is always a single name.
  if (toolUses.length > 0) {
    return `tool: ${toolUses[0]!.name}`
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

/** Truncate a label for fixed-width display, keeping the tail (unique part).
 *  e.g. "mcp: claude_ai_Gitlab/get_merge_request_details" (width=37)
 *    →  "…_Gitlab/get_merge_request_details"
 */
export function truncateLabel(label: string, width: number): string {
  if (label.length <= width) return label
  if (width <= 1) return '…'
  return '…' + label.slice(-(width - 1))
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

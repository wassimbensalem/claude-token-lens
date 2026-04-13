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

  // 2. Agent
  const agentTool = toolUses.find(t => t.name === 'Agent')
  if (agentTool) {
    const desc = String(agentTool.input['description'] ?? agentTool.input['subagent_type'] ?? 'agent')
    return `agent: ${desc.slice(0, 35)}${desc.length > 35 ? '…' : ''}`
  }

  // 3. Skill
  const skillMatch = texts.match(/Skill:\s*(\/\S+)/)
  if (skillMatch) {
    return `skill: ${skillMatch[1]}`
  }

  // 4. Other tools
  if (toolUses.length > 0) {
    const names = [...new Set(toolUses.map(t => t.name))].slice(0, 2)
    return `tool: ${names.join(', ')}`
  }

  // 5. Direct
  return '[direct]'
}

export interface Attribution {
  label: string
  tokens: number
  input: number
  cacheCreation: number
  cacheRead: number
  output: number
  turnCount: number
}

import type { Turn } from './parser.js'

export function buildAttribution(turns: Turn[]): Attribution[] {
  const map = new Map<string, Attribution>()

  for (const turn of turns) {
    const existing = map.get(turn.label)
    if (existing) {
      existing.tokens += turn.usage.total
      existing.input += turn.usage.input
      existing.cacheCreation += turn.usage.cacheCreation
      existing.cacheRead += turn.usage.cacheRead
      existing.output += turn.usage.output
      existing.turnCount += 1
    } else {
      map.set(turn.label, {
        label: turn.label,
        tokens: turn.usage.total,
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

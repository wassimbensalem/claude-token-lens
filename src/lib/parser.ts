import * as fs from 'fs'
import * as path from 'path'
import { attributeLabel } from './attributor.js'

export interface TokenUsage {
  input: number
  cacheCreation: number
  cacheRead: number
  output: number
  /** Generation cost: input + cacheCreation + output. Used for per-source attribution. */
  total: number
  /**
   * Billing-weighted cost: total + cacheRead × 0.1.
   * cacheRead is NOT attributed per-source because it reflects the entire accumulated
   * conversation context being re-read, not the work of a specific tool call.
   * Use this only for aggregate billing cost display.
   */
  billingTotal: number
}

export interface Turn {
  timestamp: Date
  sessionId: string
  filePath: string
  usage: TokenUsage
  label: string
  isSidechain: boolean
  parentToolUseID: string | null
  toolUseID: string | null
}

function parseUsage(raw: Record<string, number>): TokenUsage {
  const input = raw['input_tokens'] ?? 0
  const cacheCreation = raw['cache_creation_input_tokens'] ?? 0
  const cacheRead = raw['cache_read_input_tokens'] ?? 0
  const output = raw['output_tokens'] ?? 0
  const total = input + cacheCreation + output
  return { input, cacheCreation, cacheRead, output, total, billingTotal: total + Math.round(cacheRead * 0.1) }
}

export function parseSessionFile(filePath: string): Turn[] {
  if (!fs.existsSync(filePath)) return []

  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {
    return []
  }

  const lines = content.split('\n').filter(Boolean)
  const turns: Turn[] = []

  // Pass 1: build a map of Agent tool-use IDs → agent label so we can
  // correctly label sidechain (sub-agent) turns by which agent spawned them,
  // rather than by what the sub-agent happened to call inside its session.
  //
  // Example: CEO spawns lead-engineer via Agent(subagent_type:"lead-engineer").
  // The spawning turn gets tool_use.id = "toolu_abc". Every sidechain turn
  // from that sub-agent has toolUseID = "toolu_abc". We use this map to
  // relabel those turns as "agent: lead-engineer" regardless of their content.
  const agentCallMap = new Map<string, string>() // tool_use.id → "agent: <type>"

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>
      const msg = obj['message'] as Record<string, unknown> | undefined
      if (!msg || msg['role'] !== 'assistant') continue
      const msgContent = Array.isArray(msg['content']) ? msg['content'] as Record<string, unknown>[] : []
      for (const item of msgContent) {
        if (item['type'] !== 'tool_use' || item['name'] !== 'Agent') continue
        const id = item['id'] as string | undefined
        if (!id) continue
        const input = item['input'] as Record<string, unknown> | undefined
        const subtype = input?.['subagent_type']
        if (typeof subtype === 'string' && subtype.length > 0) {
          agentCallMap.set(id, `agent: ${subtype}`)
        } else {
          const desc = String(input?.['description'] ?? 'agent')
          agentCallMap.set(id, `agent: ${desc.slice(0, 30)}${desc.length > 30 ? '…' : ''}`)
        }
      }
    } catch { /* skip malformed lines */ }
  }

  // Pass 2: parse turns, applying agent lineage labels to sidechain turns
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>
      const msg = obj['message'] as Record<string, unknown> | undefined
      if (!msg || typeof msg !== 'object') continue
      if (msg['role'] !== 'assistant') continue
      if (!msg['usage']) continue

      const msgContent = Array.isArray(msg['content']) ? msg['content'] as unknown[] : []
      const isSidechain = obj['isSidechain'] === true
      const toolUseID = (obj['toolUseID'] as string | null) ?? null

      // If this is a sidechain turn and we know which agent spawned it,
      // use the agent label instead of inferring from content.
      const agentLineageLabel = isSidechain && toolUseID
        ? agentCallMap.get(toolUseID) ?? null
        : null

      const label = agentLineageLabel ?? attributeLabel(msgContent)
      const usage = parseUsage(msg['usage'] as Record<string, number>)

      turns.push({
        timestamp: new Date(String(obj['timestamp'] ?? Date.now())),
        sessionId: String(obj['sessionId'] ?? ''),
        filePath,
        usage,
        label,
        isSidechain,
        parentToolUseID: (obj['parentToolUseID'] as string | null) ?? null,
        toolUseID,
      })
    } catch {
      // skip malformed lines
    }
  }

  return turns
}

export function parseProject(projectDir: string): Turn[] {
  if (!fs.existsSync(projectDir)) return []

  const files = fs.readdirSync(projectDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => path.join(projectDir, f))

  const allTurns: Turn[] = []
  for (const file of files) {
    allTurns.push(...parseSessionFile(file))
  }

  return allTurns
}

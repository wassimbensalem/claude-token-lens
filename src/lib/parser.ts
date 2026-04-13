import * as fs from 'fs'
import * as path from 'path'
import { attributeLabel } from './attributor.js'

export interface TokenUsage {
  input: number
  cacheCreation: number
  cacheRead: number
  output: number
  total: number
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
  return { input, cacheCreation, cacheRead, output, total: input + cacheCreation + output }
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

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>
      const msg = obj['message'] as Record<string, unknown> | undefined
      if (!msg || typeof msg !== 'object') continue
      if (msg['role'] !== 'assistant') continue
      if (!msg['usage']) continue

      const msgContent = Array.isArray(msg['content']) ? msg['content'] as unknown[] : []
      const label = attributeLabel(msgContent)
      const usage = parseUsage(msg['usage'] as Record<string, number>)

      turns.push({
        timestamp: new Date(String(obj['timestamp'] ?? Date.now())),
        sessionId: String(obj['sessionId'] ?? ''),
        filePath,
        usage,
        label,
        isSidechain: obj['isSidechain'] === true,
        parentToolUseID: (obj['parentToolUseID'] as string | null) ?? null,
        toolUseID: (obj['toolUseID'] as string | null) ?? null,
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

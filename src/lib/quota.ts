import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { Turn } from './parser.js'

export type Plan = 'pro' | 'max5' | 'max20' | 'api'

export interface QuotaConfig {
  plan: Plan
  limit: number | null
}

export const PLAN_LIMITS: Record<Plan, number | null> = {
  pro: 44_000,
  max5: 88_000,
  max20: 220_000,
  api: null,
}

const CONFIG_PATH = path.join(os.homedir(), '.claude-token-lens.json')

export function loadConfig(): QuotaConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Partial<QuotaConfig>
    const plan = (raw.plan ?? 'max5') as Plan
    return { plan, limit: raw.limit ?? PLAN_LIMITS[plan] ?? null }
  } catch {
    return null
  }
}

export function saveConfig(config: QuotaConfig): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
  } catch {
    // ignore write errors
  }
}

export function getDefaultConfig(): QuotaConfig {
  return { plan: 'max5', limit: PLAN_LIMITS.max5 }
}

/** Filter turns to the last 5 hours (rolling window) */
export function filterRollingWindow(turns: Turn[]): Turn[] {
  const cutoff = Date.now() - 5 * 60 * 60 * 1000
  return turns.filter(t => t.timestamp.getTime() >= cutoff)
}

/** Calculate burn rate in tokens per minute from recent turns */
export function calcBurnRate(turns: Turn[], windowMinutes = 10): number {
  if (turns.length === 0) return 0
  const cutoff = Date.now() - windowMinutes * 60 * 1000
  const recent = turns.filter(t => t.timestamp.getTime() >= cutoff)
  if (recent.length === 0) return 0
  const total = recent.reduce((sum, t) => sum + t.usage.total, 0)
  return Math.round(total / windowMinutes)
}

/** Estimate minutes until limit at current burn rate. Returns null if no limit or zero rate. */
export function calcETA(usedTokens: number, limit: number, burnRate: number): number | null {
  if (burnRate <= 0 || limit <= 0) return null
  const remaining = limit - usedTokens
  if (remaining <= 0) return 0
  return Math.round(remaining / burnRate)
}

/** Format minutes as human-readable string */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/** Time until rolling window resets (5h from oldest turn in window) */
export function calcWindowReset(turns: Turn[]): number | null {
  const windowed = filterRollingWindow(turns)
  if (windowed.length === 0) return null
  const oldest = windowed.reduce((min, t) => t.timestamp.getTime() < min ? t.timestamp.getTime() : min, Infinity)
  const resetAt = oldest + 5 * 60 * 60 * 1000
  return Math.max(0, Math.round((resetAt - Date.now()) / 60000))
}

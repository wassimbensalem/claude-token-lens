import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { Turn } from './parser.js'

export type Plan = 'pro' | 'max5' | 'max20' | 'api'

export interface QuotaConfig {
  plan: Plan
  limit: number | null
}

// COMMUNITY-ESTIMATED output-token limits per 5-hour rolling window.
//
// ⚠️  WARNING: These numbers are UNVERIFIED community estimates — Anthropic has NEVER
// published exact quota figures. Key facts from research (April 2026):
//
//  - Official docs say only "at least 5× usage per session compared to free" for Pro.
//  - Limits are throttled further during peak hours (5am–11am PT weekdays).
//  - Weekly limits also exist (added August 2025) — this tool only tracks the 5h window.
//  - Limits have changed silently at least twice (September 2025, March 2026).
//  - Quota is shared per organization UUID, not per individual user.
//  - The formula counts "all tokens processed" — not output-only — but exact weights
//    for cache reads are undisclosed. These estimates were calibrated on output tokens.
//
// Calibrate via ~/.claude-token-lens.json after observing your real rate-limit cutoff.
// Run /stats inside Claude Code for the authoritative quota view.
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

/** Returns true if no config file exists yet (first run). */
export function isFirstRun(): boolean {
  return !fs.existsSync(CONFIG_PATH)
}

/** Filter turns to the last 5 hours (rolling window) */
export function filterRollingWindow(turns: Turn[]): Turn[] {
  const cutoff = Date.now() - 5 * 60 * 60 * 1000
  return turns.filter(t => t.timestamp.getTime() >= cutoff)
}

/**
 * Sum the output tokens across turns.
 *
 * Used as a proxy for quota tracking. Note: Anthropic's official docs say quota
 * counts "all tokens processed" — but the exact formula is undisclosed. The plan
 * limit estimates (44k/88k/220k) were community-calibrated using output tokens,
 * so output-only is the best consistent proxy we have.
 *
 * For actual quota remaining, users should run /stats inside Claude Code.
 */
export function sumOutputTokens(turns: Turn[]): number {
  return turns.reduce((s, t) => s + t.usage.output, 0)
}

/**
 * Sum the billing-weighted tokens (total + cacheRead×0.1) across turns.
 * Use this for overall cost display, not per-source attribution.
 */
export function sumBillingTokens(turns: Turn[]): number {
  return turns.reduce((s, t) => s + t.usage.billingTotal, 0)
}

/**
 * Calculate burn rate in tokens per minute from recent turns.
 *
 * Returns 0 (no rate) when there is insufficient data:
 *   - fewer than 2 turns in the window, AND elapsed < 2 minutes
 *   This avoids the cold-start problem where a single turn 30 seconds ago
 *   produces an inflated rate like "6,000 tok/min" due to a 1-minute floor.
 *
 * @param getTokens - selector for which token type to measure.
 *   Default: billingTotal (billing-weighted, good for cost display).
 *   Pass `t => t.usage.output` for quota/ETA calculations.
 */
export function calcBurnRate(
  turns: Turn[],
  windowMinutes = 10,
  getTokens: (t: Turn) => number = (t) => t.usage.billingTotal
): number {
  if (turns.length === 0) return 0
  const cutoff = Date.now() - windowMinutes * 60 * 1000
  const recent = turns.filter(t => t.timestamp.getTime() >= cutoff)
  if (recent.length === 0) return 0
  const earliest = recent.reduce((min, t) => Math.min(min, t.timestamp.getTime()), Infinity)
  const naturalElapsed = (Date.now() - earliest) / 60000
  // Require at least 2 turns OR 2 minutes of natural elapsed time before
  // reporting a rate — prevents cold-start inflation from a single fresh turn.
  if (recent.length < 2 && naturalElapsed < 2) return 0
  const total = recent.reduce((sum, t) => sum + getTokens(t), 0)
  const elapsedMinutes = Math.max(1, Math.min(windowMinutes, naturalElapsed))
  return Math.round(total / elapsedMinutes)
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

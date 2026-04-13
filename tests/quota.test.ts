import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  filterRollingWindow,
  calcBurnRate,
  calcETA,
  calcWindowReset,
  sumOutputTokens,
  sumBillingTokens,
  formatDuration,
  PLAN_LIMITS,
} from '../src/lib/quota.js'
import type { Turn } from '../src/lib/parser.js'

// Helper to build a Turn at a given age (minutes ago)
function turnAt(minutesAgo: number, tokens: Partial<{
  input: number; cacheCreation: number; cacheRead: number; output: number
}> = {}): Turn {
  const input = tokens.input ?? 0
  const cacheCreation = tokens.cacheCreation ?? 0
  const cacheRead = tokens.cacheRead ?? 0
  const output = tokens.output ?? 0
  const total = input + cacheCreation + output
  return {
    timestamp: new Date(Date.now() - minutesAgo * 60 * 1000),
    sessionId: 'test',
    filePath: '/test.jsonl',
    usage: {
      input, cacheCreation, cacheRead, output,
      total,
      billingTotal: total + Math.round(cacheRead * 0.1),
    },
    label: 'test',
    isSidechain: false,
    parentToolUseID: null,
    toolUseID: null,
  }
}

describe('PLAN_LIMITS', () => {
  it('has the expected community-estimated values', () => {
    expect(PLAN_LIMITS.pro).toBe(44_000)
    expect(PLAN_LIMITS.max5).toBe(88_000)
    expect(PLAN_LIMITS.max20).toBe(220_000)
    expect(PLAN_LIMITS.api).toBeNull()
  })
})

describe('filterRollingWindow', () => {
  it('keeps turns within the last 5 hours', () => {
    const turns = [
      turnAt(0),    // now — keep
      turnAt(60),   // 1h ago — keep
      turnAt(299),  // 4h59m ago — keep
      turnAt(301),  // 5h1m ago — exclude
      turnAt(600),  // 10h ago — exclude
    ]
    const result = filterRollingWindow(turns)
    expect(result).toHaveLength(3)
  })

  it('returns empty array if all turns are older than 5h', () => {
    const turns = [turnAt(400), turnAt(600)]
    expect(filterRollingWindow(turns)).toHaveLength(0)
  })

  it('returns all turns if all are within 5h', () => {
    const turns = [turnAt(1), turnAt(60), turnAt(240)]
    expect(filterRollingWindow(turns)).toHaveLength(3)
  })

  it('returns empty array for empty input', () => {
    expect(filterRollingWindow([])).toHaveLength(0)
  })
})

describe('sumOutputTokens', () => {
  it('sums only output tokens', () => {
    const turns = [
      turnAt(5, { input: 100, cacheCreation: 50, cacheRead: 1000, output: 200 }),
      turnAt(10, { input: 80, output: 150 }),
    ]
    expect(sumOutputTokens(turns)).toBe(350)
  })

  it('returns 0 for empty array', () => {
    expect(sumOutputTokens([])).toBe(0)
  })
})

describe('sumBillingTokens', () => {
  it('sums billingTotal (total + cacheRead×0.1) across turns', () => {
    const turns = [
      turnAt(5, { input: 100, output: 50, cacheRead: 1000 }),  // total=150, billing=150+100=250
      turnAt(10, { input: 200, output: 100, cacheRead: 2000 }), // total=300, billing=300+200=500
    ]
    expect(sumBillingTokens(turns)).toBe(750)
  })

  it('returns 0 for empty array', () => {
    expect(sumBillingTokens([])).toBe(0)
  })
})

describe('calcBurnRate', () => {
  it('returns 0 for empty turns', () => {
    expect(calcBurnRate([])).toBe(0)
  })

  it('returns 0 if no turns within the window', () => {
    const turns = [turnAt(60)] // older than 10-min default window
    expect(calcBurnRate(turns)).toBe(0)
  })

  it('calculates billing-weighted rate by default', () => {
    // 1 turn 5 minutes ago with billingTotal = 1000
    // elapsed ≈ 5 min → rate ≈ 200 tok/min
    const turns = [
      // billingTotal = (100+0+200) + round(0*0.1) = 300
      // but we want a predictable billing total, so use no cacheRead
      turnAt(5, { input: 100, output: 200 }), // billing = 300
    ]
    const rate = calcBurnRate(turns)
    // elapsed = 5 min, total = 300 → rate = round(300/5) = 60
    expect(rate).toBe(60)
  })

  it('accepts a token selector for output-only rate (quota mode)', () => {
    const turns = [
      turnAt(5, { input: 1000, output: 200 }), // output only = 200
    ]
    const outputRate = calcBurnRate(turns, 10, t => t.usage.output)
    // elapsed = 5, output = 200 → 200/5 = 40
    expect(outputRate).toBe(40)
  })

  it('billing rate is higher than output rate when cache is large', () => {
    const turns = [
      turnAt(5, { input: 100, cacheCreation: 0, cacheRead: 50000, output: 200 }),
    ]
    const billingRate = calcBurnRate(turns)       // uses billingTotal
    const outputRate = calcBurnRate(turns, 10, t => t.usage.output)
    expect(billingRate).toBeGreaterThan(outputRate)
  })

  it('uses elapsed time (not full window) when only 1 recent turn', () => {
    // 1 turn 3 minutes ago — elapsed = max(1, min(10, 3)) = 3
    const turns = [turnAt(3, { input: 0, output: 300 })]
    const rate = calcBurnRate(turns, 10, t => t.usage.output)
    expect(rate).toBe(100) // 300 / 3
  })
})

describe('calcETA', () => {
  it('returns null if burnRate is 0', () => {
    expect(calcETA(10000, 88000, 0)).toBeNull()
  })

  it('returns null if limit is 0', () => {
    expect(calcETA(10000, 0, 100)).toBeNull()
  })

  it('returns 0 if already at or over limit', () => {
    expect(calcETA(88000, 88000, 500)).toBe(0)
    expect(calcETA(90000, 88000, 500)).toBe(0)
  })

  it('calculates correct minutes remaining', () => {
    // used: 44000, limit: 88000, remaining: 44000
    // burnRate: 1000 tok/min → ETA: 44 min
    expect(calcETA(44000, 88000, 1000)).toBe(44)
  })

  it('rounds to nearest minute', () => {
    // remaining: 100, burnRate: 3 → 33.33... → rounds to 33
    expect(calcETA(0, 100, 3)).toBe(33)
  })
})

describe('calcWindowReset', () => {
  it('returns null for empty turns', () => {
    expect(calcWindowReset([])).toBeNull()
  })

  it('returns null if all turns are outside rolling window', () => {
    const turns = [turnAt(400)] // older than 5h — excluded by filterRollingWindow inside
    expect(calcWindowReset(turns)).toBeNull()
  })

  it('returns positive minutes when oldest turn is < 5h old', () => {
    const turns = [turnAt(120)] // 2h ago — window resets in 3h = 180 min
    const reset = calcWindowReset(turns)
    expect(reset).not.toBeNull()
    // Allow ±2 min for test execution time
    expect(reset!).toBeGreaterThanOrEqual(178)
    expect(reset!).toBeLessThanOrEqual(182)
  })

  it('uses oldest turn in window, not newest', () => {
    const turns = [
      turnAt(240), // 4h ago — oldest, window resets in ~1h
      turnAt(60),  // 1h ago — newest
    ]
    const reset = calcWindowReset(turns)
    // oldest is 240 min ago, resets at 300 min → 60 min remaining
    expect(reset!).toBeGreaterThanOrEqual(58)
    expect(reset!).toBeLessThanOrEqual(62)
  })
})

describe('formatDuration', () => {
  it('formats minutes-only durations', () => {
    expect(formatDuration(5)).toBe('5m')
    expect(formatDuration(59)).toBe('59m')
  })

  it('formats exact hours without minutes', () => {
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(120)).toBe('2h')
  })

  it('formats hours and minutes', () => {
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(125)).toBe('2h 5m')
  })

  it('formats 0 minutes', () => {
    expect(formatDuration(0)).toBe('0m')
  })
})

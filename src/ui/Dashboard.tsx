import React, { useState, useEffect } from 'react'
import { Box, Text, useInput, useApp, useStdout } from 'ink'
import type { Turn } from '../lib/parser.js'
import { buildAttribution, truncateLabel } from '../lib/attributor.js'
import {
  filterRollingWindow,
  calcBurnRate,
  calcETA,
  calcWindowReset,
  formatDuration,
  loadConfig,
  saveConfig,
  getDefaultConfig,
  PLAN_LIMITS,
  sumOutputTokens,
  sumBillingTokens,
  type Plan,
  type QuotaConfig,
} from '../lib/quota.js'

const VERSION = '0.1.4'
const PLAN_CYCLE: Plan[] = ['pro', 'max5', 'max20', 'api']

function progressBar(pct: number, width = 30): string {
  const filled = Math.round((pct / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

interface Props {
  turns: Turn[]
  projectName: string
}

export default function Dashboard({ turns, projectName }: Props) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const termHeight = stdout?.rows ?? 24
  const termWidth = stdout?.columns ?? 80
  const [config, setConfig] = useState<QuotaConfig>(loadConfig() ?? getDefaultConfig())

  // Session tabs: 0 = all sessions, 1..N = individual sessions (oldest→newest)
  const sessionIds = [...new Set(turns.map(t => t.sessionId))].filter(Boolean)
  const [sessionIdx, setSessionIdx] = useState(0)

  // Clamp sessionIdx when sessions list changes (e.g. new session appears)
  const clampedIdx = Math.min(sessionIdx, sessionIds.length)
  useEffect(() => {
    if (clampedIdx !== sessionIdx) setSessionIdx(clampedIdx)
  }, [clampedIdx, sessionIdx])

  useInput((_input, key) => {
    if (_input === 'q' || _input === 'Q') exit()
    if (_input === 'p' || _input === 'P') {
      const idx = PLAN_CYCLE.indexOf(config.plan)
      const next = PLAN_CYCLE[(idx + 1) % PLAN_CYCLE.length]!
      const newConfig: QuotaConfig = { plan: next, limit: PLAN_LIMITS[next] }
      saveConfig(newConfig)
      setConfig(newConfig)
    }
    if (key.leftArrow) {
      setSessionIdx(i => Math.max(0, i - 1))
    }
    if (key.rightArrow) {
      setSessionIdx(i => Math.min(sessionIds.length, i + 1))
    }
  })

  // Filter turns to selected session (0 = all)
  const activeTurns = clampedIdx === 0
    ? turns
    : turns.filter(t => t.sessionId === sessionIds[clampedIdx - 1])

  const windowed = filterRollingWindow(activeTurns.filter(t => !t.isSidechain))
  const sidechainTurns = filterRollingWindow(activeTurns.filter(t => t.isSidechain))
  const allAttributed = [...windowed, ...sidechainTurns]

  const generationTokens = allAttributed.reduce((s, t) => s + t.usage.total, 0)
  const quotaTokens = sumOutputTokens(windowed)
  const limit = config.limit
  const pct = limit ? Math.min(100, Math.round((quotaTokens / limit) * 100)) : 0
  const displayBurnRate = calcBurnRate(windowed)
  const quotaBurnRate = calcBurnRate(windowed, 10, t => t.usage.output)
  const eta = limit ? calcETA(quotaTokens, limit, quotaBurnRate) : null
  const resetIn = calcWindowReset(windowed)

  const attribution = buildAttribution(allAttributed)
  const sessionStart = windowed.length > 0 ? windowed[0]!.timestamp : null
  const sessionAge = sessionStart
    ? Math.round((Date.now() - sessionStart.getTime()) / 60000)
    : 0

  const barColor = pct >= 80 ? 'red' : pct >= 60 ? 'yellow' : 'green'

  // Reserve rows: header(2) + progress(2) + divider(1) + table-header(2) + divider(1)
  // + session-tabs(1) + session-info(1) + controls(2) = 13
  const visibleRows = Math.max(3, termHeight - 14)

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">claude-token-lens</Text>
        <Text dimColor>v{VERSION}  plan: {config.plan.toUpperCase()}{limit ? ` (~${(limit / 1000).toFixed(0)}k est.)` : ''}</Text>
      </Box>

      {/* Progress bar */}
      {limit ? (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text dimColor>Window~ </Text>
            <Text color={barColor}>{progressBar(pct)}</Text>
            <Text>  </Text>
            <Text bold color={barColor}>{pct}%</Text>
            <Text dimColor>  {quotaTokens.toLocaleString()} out-tok  (est. — use /stats for real limit)</Text>
          </Box>
          <Box marginTop={0}>
            <Text dimColor>
              {resetIn != null ? `Oldest turn drops in ${formatDuration(resetIn)}` : 'No data'}
              {'  │  '}
              {quotaBurnRate > 0 ? `Burn ${quotaBurnRate.toLocaleString()} out-tok/min` : 'Burn: no data'}
              {'  │  '}
              {eta != null && pct >= 40 ? `ETA ~${formatDuration(eta)}${eta < 20 ? ' ⚠️' : ''}` : 'ETA: N/A'}
            </Text>
          </Box>
        </Box>
      ) : (
        <Box marginBottom={1}>
          <Text dimColor>API mode — no quota limit  │  {sumOutputTokens(windowed).toLocaleString()} out-tok  │  {sumBillingTokens(allAttributed).toLocaleString()} billing</Text>
        </Box>
      )}

      {/* Divider */}
      <Text dimColor>{'─'.repeat(60)}</Text>

      {/* Session tabs — only shown when there are multiple sessions */}
      {sessionIds.length > 1 && (
        <Box marginBottom={0}>
          {/* "All" tab */}
          <Box marginRight={1}>
            {clampedIdx === 0
              ? <Text bold color="cyan">[ All ]</Text>
              : <Text dimColor>  All  </Text>
            }
          </Box>
          {/* Per-session tabs */}
          {sessionIds.map((id, i) => {
            const short = id.slice(0, 8)
            const active = clampedIdx === i + 1
            return active
              ? <Box key={id} marginRight={1}><Text bold color="cyan">[{short}]</Text></Box>
              : <Box key={id} marginRight={1}><Text dimColor> {short} </Text></Box>
          })}
          <Text dimColor>  ← → to switch</Text>
        </Box>
      )}

      {/* Attribution table header */}
      <Box marginTop={0}>
        <Text dimColor bold>{'Source'.padEnd(38)}</Text>
        <Text dimColor bold>{'Tokens'.padStart(8)}</Text>
        <Text dimColor bold>{'%'.padStart(7)}</Text>
        <Text dimColor bold>{'out/min'.padStart(10)}</Text>
      </Box>
      <Text dimColor>{'─'.repeat(60)}</Text>

      {/* Attribution rows */}
      {attribution.length === 0 ? (
        <Text dimColor>  No data yet — waiting for Claude Code activity...</Text>
      ) : (
        attribution.slice(0, visibleRows).map((a) => {
          const rowPct = generationTokens > 0 ? Math.round((a.tokens / generationTokens) * 100) : 0
          const rowRate = calcBurnRate(
            allAttributed.filter(t => t.label === a.label),
            10,
            t => t.usage.output
          )
          const labelColor = a.label.startsWith('agent:') ? 'magenta'
            : a.label.startsWith('mcp:') ? 'yellow'
            : a.label.startsWith('skill:') ? 'cyan'
            : a.label.startsWith('tool:') ? 'white'
            : 'gray'
          return (
            <Box key={a.label}>
              <Text color={labelColor}>{truncateLabel(a.label, 37).padEnd(38)}</Text>
              <Text>{a.tokens.toLocaleString().padStart(8)}</Text>
              <Text dimColor>{`${rowPct}%`.padStart(7)}</Text>
              <Text dimColor>{rowRate > 0 ? rowRate.toLocaleString().padStart(9) : '        '}</Text>
            </Box>
          )
        })
      )}
      {attribution.length > visibleRows && (
        <Text dimColor>  +{attribution.length - visibleRows} more sources</Text>
      )}

      {/* Divider */}
      <Text dimColor>{'─'.repeat(60)}</Text>

      {/* Session info */}
      <Box justifyContent="space-between" marginTop={0}>
        <Text dimColor>
          {projectName
            ? `Project: ${projectName.slice(0, Math.max(20, termWidth - 40))}`
            : 'Project: unknown'}
          {'  │  '}
          {`${windowed.length} turns`}
          {sessionAge > 0 ? `  │  started ${formatDuration(sessionAge)} ago` : ''}
        </Text>
      </Box>

      {/* Controls */}
      <Box marginTop={1}>
        <Text dimColor>
          [q] quit   [p] cycle plan ({PLAN_CYCLE.join(' → ')})
          {sessionIds.length > 1 ? '   [←→] switch session' : ''}
          {'   ⚠ /stats for actual quota'}
        </Text>
      </Box>
    </Box>
  )
}

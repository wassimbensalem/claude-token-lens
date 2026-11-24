---
name: Claude Code Quota System — What Is Known
description: Official and semi-official sources on Claude Code quota limits for Pro/Max5/Max20; what Anthropic publishes vs. what they don't; reliable vs. unreliable sources for this domain
type: project
---

## Core facts (high confidence)

Anthropic does NOT publish exact token quota numbers for Pro, Max5, or Max20 plans anywhere.
**Why:** Deliberately omitted; allows them to adjust limits silently (confirmed March 2026).
**How to apply:** Never cite specific token numbers (44k/88k/220k) as official — they are community estimates.

The quota system has TWO enforced windows:
1. 5-hour rolling session window (resets when next message sent after 5h elapse)
2. Weekly cap (introduced August 28, 2025; resets on what appears to be a fixed calendar week)

All tokens count against quota: input + output + cache creation + cache read.
Not output-only. Cached tokens appear to count at full weight (GitHub issue #46829 confirmed cache TTL change caused measurable quota spike).

Usage is pooled across all Claude surfaces (claude.ai, Claude Code, Claude Desktop) under one subscription limit.

Quota is tracked server-side per organizationUuid, not per account. Multiple accounts under same org share one pool (GitHub issue #41886).

Peak hours (05:00–11:00 PT) have reduced session limits since ~March 2026. Weekly totals unchanged.

## Reliable official sources

- https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan — usage shared across products
- https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work — general quota framework
- https://support.claude.com/en/articles/12429409-manage-extra-usage-for-paid-claude-plans — 5-hour reset, all tokens count
- https://code.claude.com/docs/en/costs — /cost vs /stats distinction for subscribers
- https://x.com/AnthropicAI/status/1949898502688903593 — official weekly limits announcement
- https://github.com/anthropics/claude-code/issues/41886 — org-level quota pooling, session+weekly dimensions
- https://github.com/anthropics/claude-code/issues/46829 — cache TTL change causing quota inflation

## Unreliable / unverified sources

- truefoundry.com, portkey.ai, faros.ai — cite specific token numbers (44k/88k/220k) without primary Anthropic source. Treat as community estimates only.
- Any source claiming to know exact weekly token caps — not confirmed by Anthropic.

## Open questions (as of April 2026)

- What does /stats actually output?
- Do cached tokens count at full or discounted weight toward subscription quota?
- Exact peak-hour session multipliers?
- Does weekly reset on fixed calendar day (Monday) or rolling 7 days?
- Is there a separate Opus sub-limit within the weekly cap?

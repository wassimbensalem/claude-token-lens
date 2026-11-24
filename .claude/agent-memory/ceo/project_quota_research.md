---
name: Anthropic quota mechanics research
description: Verified facts about Claude Code quota system from two-agent research (official + community sources), April 2026
type: project
---

Key findings from two-researcher investigation (April 2026) — one on official sources, one on community:

**What's official (confirmed):**
- Anthropic NEVER publishes exact quota numbers. Official page says only "at least 5× usage vs free" for Pro.
- Quota counts "all tokens processed, including project content" (official support page). Not output-only.
- Two quota windows enforced simultaneously: 5-hour rolling session AND weekly cap (added Aug 2025).
- Peak-hour throttling: limits reduced during 5am–11am PT weekdays (confirmed by Anthropic engineer Thariq Shihipar, The Register March 2026).
- Quota is tracked per organizationUuid — all accounts under same org billing share one pool.
- Relevant CLI commands: `/stats` (Pro/Max quota view), `/cost` (API billing view). There is NO `/usage` command.

**What's community-estimated (unverified):**
- 44k/88k/220k output tokens per 5h window — never confirmed by Anthropic.
- Multiple limit changes: Sept 2025 (issue #9094), March 2026 (cache TTL 1h→5min caused 20-32% quota inflation).

**Why `/usage` → `/stats` matters:**
- `/usage` doesn't exist in Claude Code. Pointing users there causes silent failure.
- `/stats` is the correct Pro/Max subscriber command for quota percentage.
- `/cost` is for API users (shows token breakdown + $ estimate, "not relevant for billing" for Pro/Max).

**How to apply:**
- All tool output, README, and help text must say `/stats` not `/usage`.
- All quota percentages must be labeled "(est.)" and deferred to `/stats` for authority.
- Weekly limit caveat must be shown in status/report commands.
- Peak-hours note should be in setup and README.

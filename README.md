# claude-token-lens

[![npm version](https://img.shields.io/npm/v/claude-token-lens)](https://www.npmjs.com/package/claude-token-lens)
[![npm downloads](https://img.shields.io/npm/dw/claude-token-lens)](https://www.npmjs.com/package/claude-token-lens)
[![GitHub stars](https://img.shields.io/github/stars/wassimbensalem/claude-token-lens?style=social)](https://github.com/wassimbensalem/claude-token-lens)

> See exactly what's burning your Claude Code quota — **live**.

Real-time token attribution for Claude Code sessions. Shows burn rate, quota progress, and a per-source breakdown: by tool, agent, skill, and MCP server.

![claude-token-lens demo](assets/demo.gif)

---

## The problem

You're running Claude Code and suddenly you've burned through your quota. But *what* consumed it?

- A skill that reads 40k tokens of context on every turn?
- An agent spawning sub-agents that each spin up their own context?
- An MCP tool hitting a large endpoint repeatedly?
- Long Bash output being read back into the model?

The built-in `/stats` command shows a total percentage — but no breakdown. **claude-token-lens** reads the same session files Claude Code writes and shows you a live, per-source attribution table.

---

## Install

```bash
npm install -g claude-token-lens
claude-token-lens live
```

Or run without installing:

```bash
npx claude-token-lens live
npx claude-token-lens sessions
npx claude-token-lens report
```

---

## Quick start

```bash
# 1. Tell the tool which plan you're on (one-time)
claude-token-lens setup

# 2. Run from inside any project you're working on with Claude Code
cd ~/my-project
claude-token-lens live
```

---

## Commands

### `live` — real-time dashboard

```
claude-token-lens live
claude-token-lens live -p /path/to/project
```

Opens a live terminal UI that refreshes as Claude Code writes new turns.

```
claude-token-lens                                        v0.1.0  plan: MAX5 (~88k est.)

Window  ████████████░░░░░░░░░░░░░░░░░░  42%  36,960 / 88,000 out-tok  (est. — use /stats for real limit)
Oldest turn drops in 1h 12m  │  Burn 420 out-tok/min  │  ETA ~2h 4m ⚠

────────────────────────────────────────────────────────────
Source                                  Tokens      %   tok/min
────────────────────────────────────────────────────────────
[direct]                                48,200    55%       230
tool: Bash                              22,100    25%       190
agent: lead-engineer                    12,400    14%
tool: Read                               4,800     5%
────────────────────────────────────────────────────────────
Project: my-project  │  38 turns  │  started 1h 22m ago

[q] quit   [p] cycle plan (pro → max5 → max20 → api)
```

**Reading the quota bar:**
```
Window  ████░░░░░░░░░░░░░░░░░░░░░░░░░░  18%  40,550 / 220,000 out-tok  (est. — use /stats for real limit)
```
The bar tracks **output tokens** as a proxy for the 5-hour rolling window. The plan limits are community estimates — Anthropic does not publish the exact formula. For your authoritative remaining quota, run `/stats` inside Claude Code.

The window is not a fixed countdown — it slides forward continuously: turns older than 5 hours drop off as new ones arrive, so usage can decrease without any action on your part.

**Reading the stats line:**
```
Oldest turn drops in 1h 12m  │  Burn 420 out-tok/min  │  ETA ~2h 4m ⚠
```
- **Oldest turn drops in** — when the oldest turn passes 5 hours, it falls off and usage decreases. This is not a full reset.
- **Burn** — your average output token rate over the last 10 minutes. Requires at least 2 turns or 2 minutes of activity — blank at cold start to avoid misleading spikes.
- **ETA** — estimated time until quota exhaustion at current burn rate. Only shown above 40% — below that, the estimate is too noisy to be useful. Shows ⚠ when under 20 minutes.

**Keys:** `q` quit · `p` cycle plan (Pro → Max5 → Max20 → API, persisted to disk)

---

### `report` — one-shot snapshot

```
claude-token-lens report
claude-token-lens report --session <uuid>
claude-token-lens report --json
claude-token-lens report --top 30
```

Prints a formatted report to stdout. Same data as the live dashboard, useful for logging or piping.

Flags:
- `--session <id>` — scope to a single session file by UUID (or UUID prefix). Skips the 5-hour window filter to show full session history.
- `--json` — machine-readable output, pipeable to `jq`
- `--top <n>` — show top N sources in the attribution table (default: 20)
- `-p, --project <path>` — specify a project directory instead of auto-detecting from cwd

The cost line separates generation from cache overhead:
```
Cost : 14,200 gen + 3,800 cache = 18,000 billing-tok
```
`gen` is what the model actually produced and processed. `cache` is the cost of re-reading the accumulated conversation context on every turn (charged at 10% of the normal input rate by Anthropic). Cache cost is shown separately because it's not attributable to any specific tool — it grows with conversation length, not with what you're doing.

The **Input overhead** section at the bottom of the report identifies where context is bleeding:
```
Input overhead
──────────────────────────────────────────────────────────
Avg context / turn   :     82,400 tok  (input + cache — everything the model processed)
Avg new input / turn :      3,100 tok  (fresh tokens: user messages + uncached tool results)
Cache creation total :     48,200 tok  (written to cache, charged once at full price)
Cache read total     :    658,000 tok  → 65,800 billing-tok (at 0.1×)
Cache % of cost      :        62%  (grows as session ages — run /compact to reset)
Heavy turns (> 164k ctx):  3 of 22 turns  ← peak bleeding points

Top 5 turns by total context  (input + cacheRead)
Source                                   NewInput    CacheRead    Output
[direct]                                    3,200      164,000     2,100
tool: Bash                                 18,400      162,000     1,800
```

`High NewInput on tool:Bash/Read` means a large tool output was fed into the next turn. `Rising CacheRead` means the session is aging — run `/compact` in Claude Code to reset.

---

### `status` — global summary

```
claude-token-lens status
```

Aggregates token usage across **all** your projects in the current 5-hour window.

```
claude-token-lens status  ─  plan: MAX5

   Output tokens (5h window) : 36,960
   Billing tokens (5h window): 118,400
   Burn rate                 : 420 output tok/min

   2 of 5 projects active in window

   ⚠️  For your actual quota limit, use /stats inside Claude Code.
   This tool can't reliably compare these numbers to Anthropic's
   internal counters — the rate-limit formula is not published.
   Note: Anthropic also enforces weekly limits (since Aug 2025)
   and reduces limits further during peak hours (5am–11am PT).

   Run 'claude-token-lens sessions' to see per-project breakdown.
```

> **Why no quota bar here?** Anthropic enforces quota server-side using a formula they don't publish. Our local token counts don't map cleanly to that number — showing a percentage bar here would give false confidence. Use `/stats` in Claude Code for the authoritative view.

---

### `sessions` — list all projects

```
claude-token-lens sessions
claude-token-lens sessions --detail
```

Scans all Claude Code projects under `~/.claude/projects/` and shows them sorted by most recently active.

```
Project              Sessions   Win out-tok    Share of window   All billing-tok   Last active
────────────────────────────────────────────────────────────────────────────────────────────────
my-project                  3        36,960  ██████████  88%         112,400        2h ago
other-project               1         4,200  █░░░░░░░░░  10%          18,900        1d ago

Total projects: 2  │  5h window: 41,160 output tokens across all projects
```

- **Win out-tok** — output tokens in the 5-hour rolling window
- **Share of window** — this project's share of your total output tokens across all projects. More useful than comparing each project to the plan limit in isolation.
- **All billing-tok** — lifetime billing-weighted total (generation + cache reads at 0.1×)

`--detail` expands each project to show individual sessions:
```
my-project    3    36,960   ██████████  88%    112,400    2h ago
  ↳ 9ab413c2…       78,200 billing-tok    28,400 out-tok (69% of window)      2h ago
  ↳ f3d01bc8…       22,100 billing-tok     6,200 out-tok (15% of window)      1d ago
```

Use the UUID shown here with `report --session <uuid>` to drill into a specific session.

---

### `setup` — configure your plan

```
claude-token-lens setup
```

One-time interactive wizard that saves your plan to `~/.claude-token-lens.json`. Without this, the quota bar defaults to Max5.

> ⚠️ **Anthropic does not publish exact quota limits.** The numbers below are community estimates, reverse-engineered from observed rate-limiting behavior. They are unverified and subject to change without notice — Anthropic has adjusted limits at least twice (September 2025, March 2026) without publishing new numbers. Treat the quota bar as a rough directional indicator, not a precise countdown. Always use `/stats` in Claude Code for your authoritative remaining quota.

| Plan | Est. output-token limit / 5h window | Notes |
|---|---|---|
| Pro | ~44,000 | Community estimate only |
| Max5 (5×) | ~88,000 | Community estimate only |
| Max20 (20×) | ~220,000 | Community estimate only |
| API key | No quota limit | |

**Limits vary by time of day:** Anthropic throttles all plans during peak hours (5am–11am PT weekdays). Your effective limit during peak hours is lower than the estimates above.

**Weekly limits also exist:** Since August 2025, Anthropic enforces a weekly cap in addition to the 5-hour session window. This tool tracks only the 5-hour window.

**Calibrating your limit:** If you hit a rate limit, note the output token count from `report` at that moment. Re-run `setup` and enter that number as a custom limit — it will be more accurate than the community estimate for your usage pattern.

---

## How attribution works

Each Claude Code turn is an assistant message in a `.jsonl` file at `~/.claude/projects/<project-slug>/`. The `message.content` array reveals what the model was doing that turn:

| Priority | Source type | Detection | Label |
|---|---|---|---|
| 1 | **MCP tool** | `tool_use.name` starts with `mcp__` | `mcp: server/method` |
| 2 | **Agent** | `tool_use.name === "Agent"` | `agent: <subagent_type>` |
| 3 | **Skill** | text contains `Skill: /name` | `skill: /name` |
| 4 | **Built-in tool** | any other `tool_use` | `tool: Bash, Read` |
| 5 | **Direct** | no tool calls | `[direct]` |

A turn is assigned the first matching label in priority order. MCP beats Agent beats Skill, etc.

**`[direct]`** means Claude produced a plain text response with no tool calls and no skill annotation. Common for planning text, explanations, and inline code. In most sessions this is the largest bucket.

**Agent lineage:** When you spawn a sub-agent via the `Agent` tool, that agent's turns appear in the main session file as sidechain turns. The parser traces them back to the spawning call's `subagent_type` — so a `lead-engineer` agent's turns are labeled `agent: lead-engineer`, not by whatever tools the sub-agent happened to call. Background agents (`run_in_background: true`) create separate session files and appear as separate sessions in `sessions --detail`.

**Token accounting:**
- **`Tokens` column** = `input + cacheCreation + output` for that source. The "generation cost" — used for per-source percentages.
- **`billing-tok`** = generation + cache reads × 0.1. The true billing cost. Shown only as an aggregate total because cache reads represent the entire conversation context, not any specific source's work.

**Sidechain turns** (sub-agents spawned via the `Agent` tool) are included in the attribution table and tracked separately from main session turns.

---

## Token types explained

| Term | What it is |
|---|---|
| **output tokens** | Tokens the model generated. Used for the quota bar and ETA (proxy metric). |
| **input tokens** | Your prompt + tool results sent to the model as fresh (uncached) tokens. |
| **cache creation** | Tokens written to the prompt cache on first use. Charged at full input price. |
| **cache read** | Tokens re-read from cache on subsequent turns. Charged at 10% of input price. Grows with conversation length. |
| **generation tokens** | `input + cacheCreation + output`. The "active" cost per turn, used for attribution. |
| **billing tokens** | `generation + round(cacheRead × 0.1)`. The weighted total that reflects true cost. |

> **On quota measurement:** Anthropic's official documentation states quota counts "all tokens processed, including project content." The exact formula — whether cache reads count and at what weight — is not published. This tool tracks output tokens as the primary quota proxy because it's what community members have used to calibrate the plan limit estimates. The numbers are directional, not authoritative.

---

## Why your `/stats` percentage may differ from this tool

Several reasons the numbers won't match exactly:

1. **Unknown formula** — Anthropic counts quota server-side using an undisclosed formula. We track output tokens as a proxy; the real formula likely includes more.
2. **Peak-hour throttling** — your effective limit is reduced during 5am–11am PT weekdays, but we apply the same limit estimate all day.
3. **Weekly limits** — Anthropic enforces a weekly cap (since August 2025) that this tool doesn't track.
4. **Org-level pooling** — quota is shared across all accounts under the same organization billing, not per-user.
5. **Cache invalidation** — bugs and policy changes (like the March 2026 cache TTL change from 1h to 5min) can cause unexpected quota drain not visible in session files.

Use this tool to understand **what** is consuming tokens and **where** your usage is heaviest — not as a replacement for `/stats`.

---

## Requirements

- Node.js ≥ 18
- Claude Code installed and running locally
- Sessions stored at `~/.claude/projects/` (default Claude Code location)

---

## License

MIT © [wassimbensalem](https://github.com/wassimbensalem)

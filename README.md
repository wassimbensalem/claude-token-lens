# claude-token-lens

> See exactly what's burning your Claude Code quota — **live**.

Real-time token attribution for Claude Code sessions. Shows burn rate, quota progress, and a per-source breakdown: by tool, agent, skill, and MCP server.

```
claude-token-lens live
```

---

## The problem

You're running Claude Code and suddenly you've burned through your quota. But *what* consumed it?

- A skill that reads 40k tokens of context on every turn?
- An agent spawning sub-agents that each spin up their own context?
- An MCP tool hitting a large endpoint repeatedly?
- Long Bash output being read back into the model?

The built-in Claude Code `/usage` display shows a total — but no breakdown. **claude-token-lens** reads the same session files Claude Code writes and shows you a live, per-source attribution table.

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

Window  ████████████░░░░░░░░░░░░░░░░░░  42%  36,960 / 88,000 output tok
Oldest turn drops in 1h 12m  │  Burn 420 tok/min  │  ETA ~2h 4m ⚠

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
Window  ████░░░░░░░░░░░░░░░░░░░░░░░░░░  18%  40,550 / 220,000 output tok
```
The bar tracks **output tokens** (what Anthropic rate-limits on) in the current 5-hour rolling window. The window is not a fixed countdown — it slides forward continuously: turns older than 5 hours drop off as new ones come in, so your usage can go *down* over time without any action on your part.

**Reading the stats line:**
```
Oldest turn drops in 1h 12m  │  Burn 420 tok/min  │  ETA ~2h 4m ⚠
```
- **Oldest turn drops in** — the oldest turn in your window was sent X hours ago. When it passes 5 hours old, it falls off and your usage count decreases. This is not a full reset.
- **Burn** — your average output token rate over the last 10 minutes (billing-weighted). Only meaningful if Claude was active recently.
- **ETA** — estimated time until you exhaust the current window's quota at the current burn rate. Only shown when you're past 40% usage — below that, the number is too large to be useful. Shows ⚠ when under 20 minutes.

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
- `--session <id>` — scope to a single session file by UUID (or UUID prefix). When set, skips the 5-hour window filter so you see the full session history.
- `--json` — machine-readable output, pipeable to `jq`
- `--top <n>` — show top N sources in the attribution table (default: 20)
- `-p, --project <path>` — specify a project directory instead of auto-detecting from cwd

The cost line separates generation from cache overhead:
```
Cost : 14,200 gen + 3,800 cache = 18,000 billing-tok
```
`gen` is what the model actually produced and processed. `cache` is the cost of re-reading the accumulated conversation context on every turn (charged at 10% of the normal input rate by Anthropic). Cache cost is shown separately because it's not attributable to any specific tool — it grows with conversation length, not with what you're doing.

---

### `sessions` — list all projects

```
claude-token-lens sessions
claude-token-lens sessions --detail
```

Scans all Claude Code projects under `~/.claude/projects/` and shows them sorted by most recently active.

```
Project              Sessions   Win out-tok  Quota           All billing-tok   Last active
──────────────────────────────────────────────────────────────────────────────────────────
my-project                  3        36,960  ████░░░░░░  42%         112,400        2h ago
other-project               1         4,200  ░░░░░░░░░░   5%          18,900        1d ago
```

- **Win out-tok** — output tokens in the 5-hour rolling window (quota-relevant)
- **Quota** — the bar and percentage are estimates based on your configured plan limit
- **All billing-tok** — lifetime billing-weighted total for the project (includes cache reads at 0.1×)

`--detail` expands each project to show individual sessions:
```
my-project    3    36,960  ████░░░░░░  42%    112,400    2h ago
  ↳ 9ab413c2…      78,200 billing-tok    28,400 out-tok (32% quota)      2h ago
  ↳ f3d01bc8…      22,100 billing-tok     6,200 out-tok  (7% quota)      1d ago
```

Use the UUID shown here with `report --session <uuid>` to drill into a specific session.

---

### `setup` — configure your plan

```
claude-token-lens setup
```

One-time interactive wizard that saves your plan to `~/.claude-token-lens.json`. Without this, the quota bar defaults to Max5 and may be inaccurate.

> ⚠️ **Anthropic does not publish exact quota limits.** The numbers below are community estimates, reverse-engineered from observed rate-limiting behavior. They are subject to change without notice. Treat the quota bar as a rough indicator, not a precise countdown.

| Plan | Estimated output-token limit / 5h window |
|---|---|
| Pro | ~44,000 |
| Max5 (5×) | ~88,000 |
| Max20 (20×) | ~220,000 |
| API key | No quota limit |

**Calibrating your limit:** If you hit a rate limit, check the output token count from `report` at that moment. Re-run `setup` and enter that number as a custom limit — it will be more accurate than the community estimate.

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

**`[direct]`** means Claude produced a plain text response with no tool calls and no skill annotation. Common for planning text, explanations, and code written inline. In most sessions this is the largest bucket — the model spends a lot of tokens just thinking and writing before calling any tool.

**Token accounting:**
- **`Tokens` column** = `input + cacheCreation + output` for that source. The "generation cost" — what that source caused the model to produce and process. Used for per-source percentages.
- **`billing-tok`** = generation + cache reads × 0.1. The true billing cost. Shown only as an aggregate total because cache reads represent the entire conversation context, not any specific source's work.

**Sidechain turns** (sub-agents spawned via the `Agent` tool) appear in the attribution table but are excluded from the rolling-window quota bar. They run in a separate rate-limit pool from the main session.

---

## Token types explained

| Term | What it is |
|---|---|
| **output tokens** | Tokens the model generated. What Anthropic rate-limits on. Used for the quota bar and ETA. |
| **input tokens** | Your prompt + tool results sent to the model. |
| **cache creation** | Tokens written to the prompt cache (first time a context block is seen). |
| **cache read** | Tokens re-read from cache on subsequent turns. Charged at 10% of input price. Grows with conversation length. |
| **generation tokens** | `input + cacheCreation + output`. The "active" cost per turn, used for attribution. |
| **billing tokens** | `generation + round(cacheRead × 0.1)`. The weighted total that reflects true cost. |

---

## Requirements

- Node.js ≥ 18
- Claude Code installed and running locally
- Sessions stored at `~/.claude/projects/` (default Claude Code location)

---

## License

MIT © [wassimbensalem](https://github.com/wassimbensalem)

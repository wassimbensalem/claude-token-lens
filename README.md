# claude-token-lens

> See exactly what's burning your Claude Code quota — **live**.

Real-time token attribution for Claude Code sessions. Shows burn rate, quota progress, and a breakdown by source: per-tool, per-agent, per-skill, per-MCP server.

```
claude-token-lens live
```

![screenshot placeholder](https://raw.githubusercontent.com/wassimbensalem/claude-token-lens/main/docs/screenshot.png)

---

## The problem

You're running Claude Code and suddenly you've burned through your Pro/Max quota. But *what* consumed it?

- Was it a skill that reads 40k tokens of context on every turn?
- An agent spawning sub-agents that each spin up their own context?
- An MCP tool hitting a big endpoint repeatedly?
- Just long Bash output being read back?

The built-in Claude Code usage display shows total tokens — but no breakdown.

**claude-token-lens** reads the same JSONL session files Claude Code writes and gives you a live, per-source attribution table.

---

## Install

```bash
npx claude-token-lens sessions    # no install needed
npx claude-token-lens report
npx claude-token-lens live
```

Or install globally:

```bash
npm install -g claude-token-lens
claude-token-lens live
```

---

## Commands

### `live` — real-time dashboard

```
claude-token-lens live
```

Opens a live terminal UI that updates as Claude Code writes new turns:

- **Quota bar**: rolling 5-hour window usage vs your plan limit
- **Burn rate**: tokens/min over the last 10 minutes
- **ETA**: estimated minutes until quota exhaustion
- **Attribution table**: top sources ranked by tokens (tool, agent, skill, MCP)

Keys: `q` quit · `p` cycle plan (Pro → Max5 → Max20 → API)

### `report` — one-shot snapshot

```
claude-token-lens report
claude-token-lens report --json
claude-token-lens report --top 30
```

Prints a formatted report for the current project. Use `--json` to pipe to `jq`.

### `sessions` — list all projects

```
claude-token-lens sessions
```

Lists all detected Claude Code projects with their token totals, session counts, and last-active time.

---

## How attribution works

Each Claude Code turn is an assistant message in a `.jsonl` file at `~/.claude/projects/`. The `message.content` array reveals what the model was doing:

| Source type | Detection | Label format |
|---|---|---|
| **MCP tool** | `tool_use.name` starts with `mcp__` | `mcp: server/method` |
| **Agent** | `tool_use.name === "Agent"` | `agent: {description}` |
| **Skill** | text contains `Skill: /name` | `skill: /name` |
| **Built-in tool** | any other `tool_use` | `tool: Bash, Read` |
| **Direct** | no tool calls | `[direct]` |

Sidechain turns (sub-agents) are included in attribution but excluded from the rolling-window quota calculation (they count against the parent session's quota).

---

## Plan limits

Configure your plan with `p` in the live UI (persisted to `~/.claude-token-lens.json`):

| Plan | Window limit |
|---|---|
| Pro | 44,000 tokens |
| Max5 | 88,000 tokens |
| Max20 | 220,000 tokens |
| API | No limit |

These match the Claude.ai rolling 5-hour conversation windows as of 2025.

---

## Requirements

- Node.js ≥ 18
- Claude Code running locally (reads `~/.claude/projects/`)

---

## License

MIT © [wassimbensalem](https://github.com/wassimbensalem)

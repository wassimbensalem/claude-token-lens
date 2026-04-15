# How I Built a Tool to See Exactly What's Burning My Claude Code Quota

Everyone using Claude Code lately has hit the same wall: quota gone, no warning, no idea why.

I built **claude-token-lens** to answer the one question Claude Code doesn't: *which tool, agent, or MCP server actually consumed my tokens?*

```bash
npm install -g claude-token-lens
claude-token-lens live
```

Here's how it works under the hood.

---

## The Data Source: Claude Code's Hidden JSONL Files

Claude Code writes every assistant turn to a `.jsonl` file — one JSON object per line — stored at:

```
~/.claude/projects/<slug>/<session-uuid>.jsonl
```

Each line is an assistant message with a `usage` block:

```json
{
  "timestamp": "2026-04-15T10:23:11.000Z",
  "sessionId": "abc123",
  "message": {
    "role": "assistant",
    "content": [
      { "type": "tool_use", "name": "Bash", "input": { "command": "npm test" } }
    ],
    "usage": {
      "input_tokens": 45230,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 180000,
      "output_tokens": 312
    }
  }
}
```

That `content[]` array is the key — it tells you *what Claude was doing* when those tokens were consumed.

---

## The Attribution Problem: Two-Pass Parsing

The tricky part is **agent spawning**. When Claude Code spawns a subagent (via the `Agent` tool), the subagent's turns land in a *separate* JSONL file. So a turn that says `tool_use: Agent` in the parent session has a corresponding chain of turns elsewhere with no obvious label.

To handle this, the parser runs two passes over each JSONL file:

**Pass 1 — Build the agent call map:**
```
toolUseID → "agent: lead-engineer"
```
Every `Agent` tool call gets recorded with its `subagent_type` (or description if no type given).

**Pass 2 — Label each turn:**
Each turn's `content[]` is checked against a 5-tier priority system:

| Tier | Pattern | Label |
|------|---------|-------|
| 1 | `tool_use.name` starts with `mcp__` | `mcp: server/method` |
| 2 | `tool_use.name === "Agent"` | `agent: subtype` |
| 3 | `tool_use.name === "Skill"` | `skill: name` |
| 3b | Text annotation matching `Skill: /name — ` | `skill: /name` |
| 4 | Any other `tool_use` | `tool: ToolName` |
| 5 | No tool use | `[direct]` |

MCP tools are identified by the `mcp__` prefix Claude Code injects: `mcp__context7__resolve-library-id` becomes `mcp: context7/resolve-library-id`.

---

## The Billing Math

Not all tokens cost the same. Claude Code's usage block has four token types:

| Field | Billing weight |
|-------|---------------|
| `input_tokens` | 1× |
| `cache_creation_input_tokens` | 1× |
| `cache_read_input_tokens` | **0.1×** |
| `output_tokens` | 1× |

Cache reads are cheap — but they dominate context at scale. A session with a large CLAUDE.md or many tool results will accumulate millions of cache-read tokens per turn. The tool tracks both **generation tokens** (for per-source attribution) and **billing tokens** (true cost = generation + cacheRead×0.1).

---

## Quota Tracking: The 5-Hour Rolling Window

Anthropic rate-limits Claude Code on a **5-hour rolling window**, not per-session or per-day. The tool filters all turns to the last 5 hours and tracks output tokens as a quota proxy.

Why output tokens only? The exact quota formula is undisclosed, but community calibration against real `/usage` data (one MAX20 user hit 94% at 617,781 output tokens) gives us:

```
Pro:   ~33,000 output tokens / 5h
Max5:  ~165,000 output tokens / 5h  
Max20: ~660,000 output tokens / 5h
```

In August 2025, Anthropic also added **weekly limits** — the tool now tracks the 7-day window too.

---

## The Live Dashboard

The `live` command uses [Ink](https://github.com/vadimdemedes/ink) — React for terminals. The watcher (`chokidar`) monitors the JSONL directory and re-renders the Ink component on every file change, giving you a live token burn view:

```
claude-token-lens                      v0.1.7  plan: MAX20 (~660k est.)

Window~ ███████████████░░░░░░░░░░░░░░  48%
Oldest turn drops in 2h 14m  │  Burn 2,970 out-tok/min  │  ETA ~1h 8m

────────────────────────────────────────────────────────────
Source                                  Tokens      %   out/min
────────────────────────────────────────────────────────────
[direct]                               440,054    50%     1,403
tool: Bash                             202,715    23%       920
tool: Read                             109,905    12%       149
agent: lead-engineer                    52,000     6%
mcp: context7/resolve                   18,200     2%
────────────────────────────────────────────────────────────
```

---

## Install and Calibrate

```bash
npm install -g claude-token-lens
claude-token-lens setup      # pick your plan
claude-token-lens live       # real-time dashboard
claude-token-lens status     # global view across all projects
claude-token-lens report     # one-shot text output
```

For the most accurate quota numbers, run `/stats` inside Claude Code — that's the authoritative source. This tool gives you the *attribution* layer that `/stats` doesn't.

Source: [github.com/wassimbensalem/claude-token-lens](https://github.com/wassimbensalem/claude-token-lens)

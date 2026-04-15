# Submission Drafts

## 1. hesreallyhim/awesome-claude-code
**Section:** Tooling 🧰 → Usage Monitors
**PR title:** Add claude-token-lens to Usage Monitors

Add this line in the Usage Monitors section, after the ccusage entry:

```
*   [claude-token-lens](https://github.com/wassimbensalem/claude-token-lens) by [wassimbensalem](https://github.com/wassimbensalem) - Real-time token attribution for Claude Code — see exactly which tool, agent, MCP, or skill is burning your quota. Live Ink dashboard with burn rate, ETA, per-session tabs, and 5h/7-day rolling window tracking.
```

---

## 2. rohitg00/awesome-claude-code-toolkit
**Section:** Companion Apps & GUIs
**PR title:** Add claude-token-lens to Companion Apps

```
| [claude-token-lens](https://github.com/wassimbensalem/claude-token-lens) | Real-time token attribution CLI — see which tool, agent, MCP, or skill is eating your quota. Live Ink dashboard, burn rate, ETA, 5h + 7-day window tracking. | `npm install -g claude-token-lens` |
```

---

## 3. Reddit Posts

### r/ClaudeAI
**Title:** I built a CLI that shows exactly which tool/agent/MCP is burning your Claude Code quota

Everyone's been hitting the quota wall lately with no visibility into why. I built claude-token-lens — it reads Claude Code's local JSONL session files and attributes every token to its source in real time.

```
npm install -g claude-token-lens
claude-token-lens live
```

Shows:
- Live quota progress bar (5h rolling window)
- Per-source breakdown: tool: Bash, agent: lead-engineer, mcp: context7/resolve, etc.
- Burn rate + ETA to limit
- 7-day window for weekly limit tracking
- Per-session tabs if you have multiple sessions open

All local, zero API calls, zero telemetry.

GitHub: https://github.com/wassimbensalem/claude-token-lens

---

### r/artificial / r/singularity
**Title:** Built a token attribution tool for Claude Code — see which AI agent is eating your quota

[same body as above, slightly less technical]

---

## 4. Product Hunt
**Tagline:** See exactly what's burning your Claude Code quota — live

**Description:**
Claude Code has been exploding in adoption — and so has everyone's quota. The problem: when you hit the limit, you have no idea why.

claude-token-lens fixes that. It reads Claude Code's local JSONL session files and shows you, in real time, which tool, agent, MCP server, or skill consumed your tokens.

**Features:**
• Live Ink dashboard with quota progress bar and burn rate
• Per-source attribution: Bash, Read, Agent calls, MCP tools, skills
• 5-hour rolling window + 7-day weekly tracking
• Per-session tab switching (←→)
• `report` command for scriptable/JSON output
• `status` for cross-project aggregate (matches /stats)
• Zero telemetry, fully local, open source

**Install:**
```
npm install -g claude-token-lens
```

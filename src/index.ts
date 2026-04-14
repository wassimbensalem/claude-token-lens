#!/usr/bin/env node
import { Command } from 'commander'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as { version: string }
import { liveCommand } from './commands/live.js'
import { sessionsCommand } from './commands/sessions.js'
import { reportCommand } from './commands/report.js'
import { setupCommand } from './commands/setup.js'
import { statusCommand } from './commands/status.js'

const program = new Command()

program
  .name('claude-token-lens')
  .description('Real-time token usage attribution for Claude Code — see exactly what is burning your quota')
  .version(version)

program
  .command('live')
  .description('Live dashboard: real-time burn rate, quota progress, per-source breakdown')
  .option('-p, --project <path>', 'Path to a specific Claude project directory')
  .action(async (opts) => {
    await liveCommand(opts)
  })

program
  .command('report')
  .description('One-shot report: token breakdown for the current project')
  .option('-p, --project <path>', 'Path to a specific Claude project directory')
  .option('-s, --session <id>', 'Restrict to a single session UUID, or "current" for the latest')
  .option('-w, --watch', 'Re-render on every session change (like live, but text-only)')
  .option('--json', 'Output as JSON')
  .option('--top <n>', 'Show top N sources (default: 20)', (v) => parseInt(v, 10))
  .action((opts) => {
    reportCommand(opts)
  })

program
  .command('sessions')
  .description('List all Claude Code projects with their token totals')
  .option('-d, --detail', 'Show individual sessions within each project')
  .action((opts) => {
    sessionsCommand(opts)
  })

program
  .command('status')
  .description('Global token usage across all projects — run /stats in Claude Code for actual quota')
  .action(() => {
    statusCommand()
  })

program
  .command('setup')
  .description('Set your Claude plan so quota bars are accurate')
  .action(async () => {
    await setupCommand()
  })

// Default command: live
program
  .action(async () => {
    await liveCommand()
  })

program.parse()

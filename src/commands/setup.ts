import { createInterface } from 'readline/promises'
import {
  PLAN_LIMITS,
  saveConfig,
  loadConfig,
  type Plan,
  type QuotaConfig,
} from '../lib/quota.js'

const PLAN_DESCRIPTIONS: Record<Plan, string> = {
  pro:   'Claude Pro         (~44k output tokens / 5h)',
  max5:  'Claude Max (5×)    (~88k output tokens / 5h)',
  max20: 'Claude Max (20×)   (~220k output tokens / 5h)',
  api:   'API key            (no quota limit)',
}

/** Wraps rl.question so it resolves with '' instead of hanging on stdin EOF */
async function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  const ac = new AbortController()
  const onClose = () => ac.abort()
  rl.once('close', onClose)
  try {
    const answer = await rl.question(question, { signal: ac.signal })
    rl.removeListener('close', onClose)
    return answer
  } catch {
    // aborted (stdin EOF) or any other error — return empty string
    return ''
  }
}

export async function setupCommand(): Promise<void> {
  const existing = loadConfig()
  process.stdin.resume()
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log('\nclaude-token-lens setup')
  console.log('─'.repeat(50))
  if (existing) {
    console.log(`Current plan: ${existing.plan.toUpperCase()}  (limit: ${existing.limit?.toLocaleString() ?? 'none'} output tokens)`)
    console.log()
  }

  console.log('Which Claude Code plan are you on?\n')
  const plans: Plan[] = ['pro', 'max5', 'max20', 'api']
  plans.forEach((p, i) => {
    const marker = existing?.plan === p ? ' ◀ current' : ''
    console.log(`  [${i + 1}] ${PLAN_DESCRIPTIONS[p]}${marker}`)
  })
  console.log()

  let chosen: Plan | null = null
  while (!chosen) {
    const answer = (await ask(rl, 'Enter 1–4: ')).trim()
    if (answer === '') {
      // stdin EOF before a valid choice — abort
      rl.close()
      process.stdin.destroy()
      console.log('\nSetup cancelled.')
      return
    }
    const idx = parseInt(answer, 10) - 1
    if (idx >= 0 && idx < plans.length) {
      chosen = plans[idx]!
    } else {
      console.log('  Please enter a number between 1 and 4.')
    }
  }

  let customLimit: number | null = PLAN_LIMITS[chosen]

  // Offer custom limit override for non-API plans
  if (chosen !== 'api') {
    console.log()
    console.log(`Default limit for ${chosen.toUpperCase()}: ${customLimit?.toLocaleString()} output tokens`)
    console.log('These are estimates. If you know your exact cutoff, you can override it.')
    const override = (await ask(rl, 'Custom limit? (press Enter to keep default): ')).trim()
    if (override !== '') {
      const parsed = parseInt(override.replace(/[,_]/g, ''), 10)
      if (!isNaN(parsed) && parsed > 0) {
        customLimit = parsed
        console.log(`  Set to ${customLimit.toLocaleString()}`)
      } else {
        console.log('  Invalid number — keeping default.')
      }
    }
  }

  const config: QuotaConfig = { plan: chosen, limit: customLimit }
  saveConfig(config)

  console.log()
  console.log(`Saved: plan=${chosen.toUpperCase()}, limit=${customLimit?.toLocaleString() ?? 'none'}`)
  console.log('Config stored at ~/.claude-token-lens.json')
  console.log()
  console.log('You can re-run setup any time, or press [p] in the live dashboard to cycle plans.')
  console.log()

  rl.close()
  process.stdin.destroy()
}

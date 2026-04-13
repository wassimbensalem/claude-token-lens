import chokidar from 'chokidar'
import { parseProject } from './parser.js'
import type { Turn } from './parser.js'

export function watchProject(
  projectDir: string,
  onChange: (turns: Turn[]) => void
): () => void {
  const watcher = chokidar.watch(`${projectDir}/*.jsonl`, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  })

  const reload = () => {
    const turns = parseProject(projectDir)
    onChange(turns)
  }

  watcher.on('add', reload)
  watcher.on('change', reload)

  // Initial load
  reload()

  return () => { watcher.close() }
}

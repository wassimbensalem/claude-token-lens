import chokidar from 'chokidar'
import { parseSessionFile } from './parser.js'
import type { Turn } from './parser.js'

export function watchProject(
  projectDir: string,
  onChange: (turns: Turn[]) => void
): () => void {
  const fileCache = new Map<string, Turn[]>()

  const emitAll = () => {
    const all: Turn[] = []
    for (const turns of fileCache.values()) all.push(...turns)
    onChange(all)
  }

  const reloadFile = (filePath: string) => {
    fileCache.set(filePath, parseSessionFile(filePath))
    emitAll()
  }

  const watcher = chokidar.watch(`${projectDir}/*.jsonl`, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  })

  watcher.on('add', reloadFile)
  watcher.on('change', reloadFile)

  return () => { watcher.close() }
}

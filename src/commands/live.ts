import React, { useState, useEffect } from 'react'
import { render } from 'ink'
import type { Turn } from '../lib/parser.js'
import { watchProject } from '../lib/watcher.js'
import { detectCurrentProjectDir, resolveProjectName } from '../lib/paths.js'
import * as path from 'path'
import Dashboard from '../ui/Dashboard.js'

interface LiveOptions {
  project?: string
}

function App({ projectDir, projectName }: { projectDir: string; projectName: string }) {
  const [turns, setTurns] = useState<Turn[]>([])

  useEffect(() => {
    const stop = watchProject(projectDir, (newTurns) => {
      setTurns(newTurns)
    })
    return () => { stop() }
  }, [projectDir])

  return React.createElement(Dashboard, { turns, projectName })
}

export async function liveCommand(opts: LiveOptions = {}): Promise<void> {
  let projectDir: string | null = null
  let projectName = ''

  if (opts.project) {
    // Explicit project slug or path
    projectDir = opts.project
    projectName = path.basename(opts.project)
  } else {
    projectDir = detectCurrentProjectDir()
    if (projectDir) {
      projectName = resolveProjectName(projectDir)
    }
  }

  if (!projectDir) {
    console.error('No Claude Code project found for the current directory.')
    console.error('Run from inside a project that has active Claude Code sessions,')
    console.error('or use: claude-token-lens sessions  to see available projects.')
    process.exit(1)
  }

  const { waitUntilExit } = render(
    React.createElement(App, { projectDir, projectName })
  )

  await waitUntilExit()
}

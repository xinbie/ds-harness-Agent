#!/usr/bin/env node
/**
 * coridis command-line entry. It parses the invocation, then either prints
 * static help/version text or launches a profile and waits for its run.
 *
 * @module @coridis/cli/bin
 */

import { pathToFileURL } from 'node:url'
import { parseArgs } from './args.ts'
import { reportError, runProfile } from './profile-boot.ts'

// A closed stdout (for example `coridis ... | head`) is not a failure of the run.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0)
  throw error
})

/** Run the public coridis CLI. */
export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const invocation = parseArgs(argv)
    switch (invocation.mode) {
      case 'help':
        process.stdout.write([
          'coridis - a minimal Cordis-based agent harness',
          '',
          'Usage: coridis [options] "<task>"',
          '',
          'Options:',
          '  --profile <name>   Profile to launch (default: headless)',
          '  --patch <file>     Extra patch file; repeatable',
          '  --json             Emit newline-delimited session events',
          '  -h, --help         Show this help',
          '  -v, --version      Show the version',
          '',
          'Environment:',
          '  DEEPSEEK_API_KEY   DeepSeek model API key (required)',
          '  TAVILY_API_KEY     Tavily search API key (required for web_search)',
          '  CORIDIS_PROFILE_DIR  Override the profile directory',
          '',
        ].join('\n'))
        return
      case 'version':
        process.stdout.write('coridis 0.0.0\n')
        return
      case 'run':
        await runProfile({
          profile: invocation.profile,
          task: invocation.task,
          patches: invocation.patches,
          json: invocation.json,
        })
        return
    }
  } catch (error) {
    reportError(error)
  }
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await runCli()
}

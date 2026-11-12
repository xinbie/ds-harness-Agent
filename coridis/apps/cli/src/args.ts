/**
 * CLI argument vocabulary and parser. The command shape is intentionally
 * small: one positional task, a profile selector, repeatable patches, and a
 * JSON output switch.
 *
 * @module @coridis/cli/args
 */

/** One parsed invocation. */
export type Invocation =
  | {
      readonly mode: 'run'
      readonly task: string
      readonly profile: string
      readonly patches: readonly string[]
      readonly json: boolean
    }
  | { readonly mode: 'help' }
  | { readonly mode: 'version' }

/** A user-facing command-line error, rendered without a stack trace. */
export class UsageError extends Error {
  override readonly name = 'UsageError'
}

const HELP_FLAGS = new Set(['-h', '--help'])
const VERSION_FLAGS = new Set(['-v', '--version'])

/** Parse `"<task>"`, `--profile <name>`, repeated `--patch <file>`, `--json`. */
export function parseArgs(argv: readonly string[]): Invocation {
  if (argv.some(argument => HELP_FLAGS.has(argument))) return { mode: 'help' }
  if (argv.some(argument => VERSION_FLAGS.has(argument))) return { mode: 'version' }

  let profile = 'headless'
  let json = false
  const patches: string[] = []
  const positional: string[] = []

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === undefined) continue

    if (argument === '--json') {
      json = true
      continue
    }
    if (argument === '--') {
      positional.push(...argv.slice(index + 1))
      break
    }
    if (argument === '--profile' || argument.startsWith('--profile=')) {
      const value = argument === '--profile'
        ? argv[++index]
        : argument.slice('--profile='.length)
      if (value === undefined || value === '') {
        throw new UsageError('--profile requires a name')
      }
      profile = value
      continue
    }
    if (argument === '--patch' || argument.startsWith('--patch=')) {
      const value = argument === '--patch'
        ? argv[++index]
        : argument.slice('--patch='.length)
      if (value === undefined || value === '') {
        throw new UsageError('--patch requires a file')
      }
      patches.push(value)
      continue
    }
    if (argument.startsWith('-')) {
      throw new UsageError(`unknown option: ${argument}`)
    }
    positional.push(argument)
  }

  const task = positional.join(' ').trim()
  if (task === '') {
    throw new UsageError('a task is required')
  }
  return { mode: 'run', task, profile, patches, json }
}

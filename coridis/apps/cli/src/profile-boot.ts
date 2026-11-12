/**
 * Profile launch: resolve the profile's bundle layers, apply user patches and
 * the CLI's startup overrides, boot Cordis, wait for the one-shot run to
 * settle, and dispose the tree.
 *
 * @module @coridis/cli/profile-boot
 */

import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bootProfile, StartupError } from '@coridis/app-boot'
import type { PatchLayer } from '@coridis/app-boot'
import type { HeadlessResult } from '@coridis/headless'
import { UsageError } from './args.ts'

/** Inputs for one profile launch. */
export interface RunProfileOptions {
  /** Profile name, e.g. `headless`. */
  readonly profile: string
  /** Task text for the one-shot runner. */
  readonly task: string
  /** Ordered patch files applied after the bundle layers. */
  readonly patches: readonly string[]
  /** Emit newline-delimited events instead of final text. */
  readonly json: boolean
}

/** Boot the profile, run the task, and report the outcome. */
export async function runProfile(options: RunProfileOptions): Promise<HeadlessResult> {
  const profileDir = await resolveProfileDir(options.profile)
  const layer: PatchLayer = {
    updates: [{
      id: 'headless-startup',
      config: {
        task: options.task,
        json: options.json,
      },
    }],
  }

  const booted = await bootProfile({
    profileDir,
    patches: options.patches,
    resolveFrom: fileURLToPath(new URL('../package.json', import.meta.url)),
    layers: [layer],
  })

  try {
    const result = await booted.ctx.headlessRun.done
    if (result.error !== undefined) {
      process.stderr.write(`coridis: ${result.error.message}\n`)
      process.exitCode = 1
    }
    return result
  } finally {
    await booted.dispose()
  }
}

async function resolveProfileDir(profile: string): Promise<string> {
  const explicit = process.env.CORIDIS_PROFILE_DIR
  if (explicit) return resolve(explicit)

  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(process.cwd(), 'profiles', profile),
    resolve(here, '..', '..', 'profiles', profile),
    resolve(here, '..', 'profiles', profile),
  ]
  for (const candidate of candidates) {
    try {
      await access(resolve(candidate, 'profile.yml'))
      return candidate
    } catch {
      // Try the next layout.
    }
  }
  throw new StartupError(
    `cannot find profile "${profile}"; looked in ${candidates.join(', ')}`,
  )
}

/** Render a CLI failure without a stack trace. */
export function reportError(error: unknown): void {
  if (error instanceof UsageError) {
    process.stderr.write(`coridis: ${error.message}\n`)
    process.stderr.write('Usage: coridis [options] "<task>"\n')
    process.exitCode = 2
    return
  }
  if (error instanceof StartupError) {
    process.stderr.write(`coridis: ${error.message}\n`)
    process.exitCode = 1
    return
  }
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`coridis: ${message}\n`)
  process.exitCode = 1
}

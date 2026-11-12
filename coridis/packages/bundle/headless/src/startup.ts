/**
 * The one-shot command-line provider. It receives the task positional, session
 * identity, and output mode from the CLI and publishes `headlessStartup` for
 * the runner row to read.
 *
 * @module @coridis/headless/startup
 */

import type { Context } from '@deepseek-ai/cordis'

/** Stable Cordis plugin name. */
export const name = 'headless-startup'

/** Service name provided by this plugin and injected by the runner. */
export const HEADLESS_STARTUP_SERVICE = 'headlessStartup'

/** Values the runner reads from {@link HEADLESS_STARTUP_SERVICE}. */
export interface HeadlessStartupValues {
  /** Task text; absent means the runner reads stdin. */
  readonly task?: string
  /** Exact Session identity to adopt; absent means a fresh one. */
  readonly sessionId?: string
  /** Emit newline-delimited events instead of final text. */
  readonly json: boolean
}

/** Plugin configuration, written by the CLI's in-memory patch layer. */
export interface Config {
  readonly task?: string
  readonly sessionId?: string
  readonly json?: boolean
}

/** Publish the startup values consumed by `@coridis/headless`. */
export function apply(ctx: Context, config: Config = {}): void {
  const values: HeadlessStartupValues = {
    json: config.json ?? false,
    ...(config.task === undefined ? {} : { task: config.task }),
    ...(config.sessionId === undefined ? {} : { sessionId: config.sessionId }),
  }
  ctx.provide(HEADLESS_STARTUP_SERVICE, values)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    headlessStartup: HeadlessStartupValues
  }
}

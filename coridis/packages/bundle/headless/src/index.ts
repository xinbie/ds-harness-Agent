/**
 * The one-shot runner: create one Agent through `ctx.agents`, submit the task,
 * wait for quiescence, print the final assistant text (or NDJSON when `json`),
 * and expose completion through `ctx.headlessRun`. The CLI owns process exit.
 *
 * @module @coridis/headless
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@coridis/agent'
import type { Session, SessionEvent } from '@coridis/session'
import type { HeadlessStartupValues } from './startup.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'headless'

/** The startup provider plus the core services the runner drives. */
export const inject = ['headlessStartup', 'agents', 'sessions']

/** Runner overrides; normally everything comes from `headlessStartup`. */
export interface Config {
  readonly task?: string
  readonly sessionId?: string
  readonly json?: boolean
}

/** One finished one-shot run. */
export interface HeadlessResult {
  readonly sessionId: string
  readonly text: string
  readonly error?: Error
}

/** Completion handle exposed as `ctx.headlessRun`. */
export interface HeadlessRun {
  readonly done: Promise<HeadlessResult>
}

/** Start the one-shot run and publish its completion promise. */
export function apply(ctx: Context, config: Config = {}): void {
  const startup = ctx.headlessStartup
  const done = run(ctx, startup, config)
  ctx.provide('headlessRun', { done })
}

async function run(
  ctx: Context,
  startup: HeadlessStartupValues,
  config: Config,
): Promise<HeadlessResult> {
  const json = config.json ?? startup.json
  const sessionId = config.sessionId ?? startup.sessionId
  let handle: AgentHandle | undefined
  let session: Session | undefined

  try {
    const task = (config.task ?? startup.task ?? await readStdin()).trim()
    if (task === '') {
      throw new Error('no task was provided')
    }

    handle = await ctx.agents.create(sessionId === undefined ? {} : { sessionId })
    session = ctx.sessions.get(handle.agent.sessionId)
    const startOffset = session?.events.length ?? 0

    if (json && session !== undefined) {
      const emit = (eventSession: Session, event: SessionEvent): void => {
        if (eventSession.id !== handle?.agent.sessionId) return
        process.stdout.write(`${JSON.stringify({
          sessionId: eventSession.id,
          type: event.type,
          seq: event.seq,
          data: event.data,
        })}\n`)
      }
      ctx.on('session/event', emit)
    }

    handle.agent.followup(task)
    await handle.agent.whenIdle()

    const events = session?.events.slice(startOffset) ?? []
    const text = json ? '' : lastAssistantText(events)
    if (!json && text !== '') {
      process.stdout.write(`${text}\n`)
    }
    return {
      sessionId: handle.agent.sessionId,
      text,
      ...(handle.agent.lastError === undefined ? {} : { error: handle.agent.lastError }),
    }
  } catch (error) {
    return {
      sessionId: handle?.agent.sessionId ?? sessionId ?? '',
      text: '',
      error: error instanceof Error ? error : new Error(String(error)),
    }
  } finally {
    if (handle !== undefined) await handle.dispose()
  }
}

function lastAssistantText(events: readonly SessionEvent[]): string {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'assistant/message' && event.data.text.trim() !== '') {
      return event.data.text
    }
  }
  return ''
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    headlessRun: HeadlessRun
  }
}

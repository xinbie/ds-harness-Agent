/**
 * Append-only Session event log and the `ctx.sessions` service. The log is the
 * source of truth from which model history is derived; live UI and SDK views
 * are projections of it.
 *
 * @module @coridis/session
 */

import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, Message } from '@coridis/llm'

/** Stable identity of one conversation log. */
export type SessionId = string

/** Monotonic offset of an event in a Session log. */
export type SessionLogOffset = number

/** Immutable metadata written when a Session is created. */
export interface SessionHeader {
  readonly id: SessionId
  readonly createdAt: string
  readonly cwd?: string
}

/** One model-requested tool call, recorded for replay. */
export interface SessionToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: string
}

/** Durable facts owned by the session and agent loop. */
export interface SessionEventData {
  'turn/start': { readonly turnId: string; readonly input: readonly string[] }
  'turn/end': { readonly turnId: string; readonly status: 'completed' | 'error' | 'aborted' }
  'step/start': { readonly turnId: string; readonly step: number }
  'step/end': {
    readonly turnId: string
    readonly step: number
    readonly reason: 'stop' | 'tool-calls' | 'length' | 'error'
  }
  'prompt/assembled': {
    readonly turnId: string
    readonly step: number
    readonly system: string
    readonly tools: readonly string[]
  }
  'user/message': { readonly text: string }
  'assistant/message': {
    readonly text: string
    readonly toolCalls: readonly SessionToolCall[]
  }
  'tool/call': {
    readonly callId: string
    readonly name: string
    readonly arguments: string
  }
  'tool/result': {
    readonly callId: string
    readonly name: string
    readonly content: string
    readonly isError: boolean
  }
  'run/error': { readonly message: string; readonly stack: string }
}

/** One durable event, discriminated by `type`. */
export type SessionEvent = {
  [K in keyof SessionEventData]: {
    readonly type: K
    readonly seq: SessionLogOffset
    readonly data: SessionEventData[K]
  }
}[keyof SessionEventData]

/** An event before the store assigns its offset. */
export type SessionEventInput = {
  [K in keyof SessionEventData]: {
    readonly type: K
    readonly data: SessionEventData[K]
  }
}[keyof SessionEventData]

/** One open Session handle. */
export interface Session {
  readonly id: SessionId
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
  /** Append one durable event and return its offset. */
  append(event: SessionEventInput): SessionLogOffset
}

/** Generate a fresh opaque Session id. */
export function createSessionId(): SessionId {
  return randomUUID()
}

class SessionHandle implements Session {
  readonly events: SessionEvent[] = []

  constructor(
    readonly header: SessionHeader,
    private readonly publish: (event: SessionEvent) => void,
  ) {}

  get id(): SessionId {
    return this.header.id
  }

  append(event: SessionEventInput): SessionLogOffset {
    const seq = this.events.length
    const stored = { ...event, seq } as SessionEvent
    this.events.push(stored)
    this.publish(stored)
    return seq
  }
}

/** Session registry. This implementation stores logs in memory. */
export class SessionStore extends Service {
  private readonly store = new Map<SessionId, SessionHandle>()

  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }

  /** Create a Session and publish `session/created`. */
  create(header: Omit<SessionHeader, 'createdAt'>): Session {
    if (this.store.has(header.id)) {
      throw new Error(`session "${header.id}" already exists`)
    }
    const full: SessionHeader = {
      ...header,
      createdAt: new Date().toISOString(),
    }
    const session = new SessionHandle(full, (event) => {
      this.ctx.emit('session/event', session, event)
    })
    this.store.set(full.id, session)
    this.ctx.emit('session/created', session)
    return session
  }

  /** Resolve an open Session by id. */
  get(id: SessionId): Session | undefined {
    return this.store.get(id)
  }

  /** Derive provider-neutral model history from the durable event log. */
  deriveMessages(session: Session): readonly Message[] {
    const messages: Message[] = []
    for (const event of session.events) {
      switch (event.type) {
        case 'user/message':
          messages.push({ role: 'user', content: event.data.text })
          break
        case 'assistant/message': {
          const content: ContentBlock[] = []
          if (event.data.text !== '') {
            content.push({ type: 'text', text: event.data.text })
          }
          for (const call of event.data.toolCalls) {
            content.push({
              type: 'tool-call',
              id: call.id,
              name: call.name,
              arguments: call.arguments,
            })
          }
          const only = content[0]
          messages.push({
            role: 'assistant',
            content: content.length === 1 && only?.type === 'text' ? only.text : content,
          })
          break
        }
        case 'tool/result':
          messages.push({
            role: 'tool',
            content: [{
              type: 'tool-result',
              toolCallId: event.data.callId,
              content: event.data.content,
              isError: event.data.isError,
            }],
          })
          break
        default:
          break
      }
    }
    return messages
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessions: SessionStore
  }

  interface Events {
    /** A new Session was opened. @mode emit */
    'session/created'(session: Session): void

    /** One durable fact was appended to a Session. @mode emit */
    'session/event'(session: Session, event: SessionEvent): void
  }
}

/** Cordis mounts the service class directly. */
export default SessionStore

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { createSessionId, SessionStore } from '../src/index.ts'
import type { SessionEvent } from '../src/index.ts'

async function mount(): Promise<{ ctx: Context; sessions: SessionStore }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  return { ctx, sessions: ctx.sessions }
}

describe('SessionStore', () => {
  it('creates sessions with a header and announces them', async () => {
    const { ctx, sessions } = await mount()
    const created: string[] = []
    ctx.on('session/created', session => created.push(session.id))

    const session = sessions.create({ id: 'session-1', cwd: '/work' })

    expect(session.id).toBe('session-1')
    expect(session.header.id).toBe('session-1')
    expect(session.header.cwd).toBe('/work')
    expect(Number.isNaN(Date.parse(session.header.createdAt))).toBe(false)
    expect(created).toEqual(['session-1'])
    expect(sessions.get('session-1')).toBe(session)
    expect(sessions.get('missing')).toBeUndefined()
  })

  it('rejects duplicate session ids', async () => {
    const { sessions } = await mount()
    sessions.create({ id: 'same' })
    expect(() => sessions.create({ id: 'same' })).toThrow(/already exists/)
  })

  it('assigns monotonic offsets and publishes every event', async () => {
    const { ctx, sessions } = await mount()
    const session = sessions.create({ id: 'log' })
    const observed: SessionEvent[] = []
    ctx.on('session/event', (_session, event) => observed.push(event))

    expect(session.append({ type: 'turn/start', data: { turnId: 't1', input: ['hi'] } })).toBe(0)
    expect(session.append({ type: 'user/message', data: { text: 'hi' } })).toBe(1)
    expect(session.append({
      type: 'assistant/message',
      data: { text: 'hello', toolCalls: [] },
    })).toBe(2)

    expect(observed.map(event => event.type)).toEqual([
      'turn/start',
      'user/message',
      'assistant/message',
    ])
    expect(observed.map(event => event.seq)).toEqual([0, 1, 2])
    expect(session.events).toHaveLength(3)
  })

  it('derives provider-neutral history from user, assistant, and tool events', async () => {
    const { sessions } = await mount()
    const session = sessions.create({ id: 'history' })

    session.append({ type: 'turn/start', data: { turnId: 't1', input: ['read it'] } })
    session.append({ type: 'user/message', data: { text: 'read it' } })
    session.append({
      type: 'assistant/message',
      data: {
        text: 'I will read it.',
        toolCalls: [{ id: 'call-1', name: 'read', arguments: '{"path":"a.txt"}' }],
      },
    })
    session.append({
      type: 'tool/call',
      data: { callId: 'call-1', name: 'read', arguments: '{"path":"a.txt"}' },
    })
    session.append({
      type: 'tool/result',
      data: { callId: 'call-1', name: 'read', content: '1→hello', isError: false },
    })
    session.append({
      type: 'assistant/message',
      data: { text: 'It says hello.', toolCalls: [] },
    })

    expect(sessions.deriveMessages(session)).toEqual([
      { role: 'user', content: 'read it' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will read it.' },
          {
            type: 'tool-call',
            id: 'call-1',
            name: 'read',
            arguments: '{"path":"a.txt"}',
          },
        ],
      },
      {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call-1',
          content: '1→hello',
          isError: false,
        }],
      },
      { role: 'assistant', content: 'It says hello.' },
    ])
  })

  it('uses a content array for a tool-only assistant message', async () => {
    const { sessions } = await mount()
    const session = sessions.create({ id: 'tool-only' })
    session.append({
      type: 'assistant/message',
      data: {
        text: '',
        toolCalls: [{ id: 'c', name: 'read', arguments: '{}' }],
      },
    })

    expect(sessions.deriveMessages(session)).toEqual([{
      role: 'assistant',
      content: [{ type: 'tool-call', id: 'c', name: 'read', arguments: '{}' }],
    }])
  })

  it('creates opaque, distinct session ids', () => {
    expect(createSessionId()).not.toBe(createSessionId())
    expect(createSessionId()).toMatch(/^[0-9a-f-]{36}$/)
  })
})

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { AgentRegistry } from '@coridis/agent'
import * as agentLoop from '@coridis/agent-loop'
import { LlmService } from '@coridis/llm'
import type { LlmAdapter, StreamChunk, StreamRequest } from '@coridis/llm'
import { SessionStore } from '@coridis/session'
import { SystemPromptService } from '@coridis/system-prompt'
import { ToolsService } from '@coridis/tools'
import type { ToolDefinition } from '@coridis/tools'

interface Harness {
  readonly ctx: Context
  readonly requests: StreamRequest[]
}

async function mount(
  respond: (request: StreamRequest, call: number) => readonly StreamChunk[],
  config: agentLoop.Config = {},
): Promise<Harness> {
  const ctx = new Context()
  const requests: StreamRequest[] = []
  let calls = 0
  const adapter: LlmAdapter = {
    id: 'fake',
    models: ['fake-model'],
    async *stream(request) {
      requests.push(request)
      calls++
      for (const chunk of respond(request, calls)) yield chunk
    },
  }
  const echo: ToolDefinition = {
    name: 'echo',
    description: 'Echo a value.',
    parameters: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    },
    async execute(args) {
      if (typeof args.value !== 'string' || args.value === '') {
        throw new Error('"value" must be a non-empty string')
      }
      return { content: [{ type: 'text', text: `echo:${args.value}` }] }
    },
  }

  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmService)
  await ctx.plugin(SystemPromptService)
  await ctx.plugin(ToolsService)
  await ctx.plugin(AgentRegistry)
  ctx.llm.registerAdapter(adapter)
  ctx.tools.register(echo)
  await ctx.plugin(agentLoop, { model: 'fake-model', maxSteps: 4, ...config })
  return { ctx, requests }
}

function chunkText(events: readonly { type: string; data?: unknown }[]): string[] {
  return events.map(event => event.type)
}

describe('agent loop', () => {
  it('runs a tool step, records the cycle, and finishes the turn', async () => {
    const { ctx, requests } = await mount((_request, call) => call === 1
      ? [
          {
            type: 'tool-call',
            call: { type: 'tool-call', id: 'call-1', name: 'echo', arguments: '{"value":"hi"}' },
          },
          { type: 'finish', reason: 'tool-calls' },
        ]
      : [
          { type: 'text-delta', text: 'done' },
          { type: 'finish', reason: 'stop' },
        ])
    const statuses: string[] = []
    ctx.on('agent/status', payload => statuses.push(payload.status))

    const handle = await ctx.agents.create({})
    const { agent } = handle
    const session = ctx.sessions.get(agent.sessionId)
    expect(session).toBeDefined()

    agent.followup('please echo')
    await agent.whenIdle()

    expect(chunkText(session?.events ?? [])).toEqual([
      'turn/start',
      'user/message',
      'step/start',
      'prompt/assembled',
      'assistant/message',
      'step/end',
      'tool/call',
      'tool/result',
      'step/start',
      'prompt/assembled',
      'assistant/message',
      'step/end',
      'turn/end',
    ])
    expect(statuses).toEqual(['running', 'idle'])
    expect(agent.status).toBe('idle')
    expect(agent.lastError).toBeUndefined()

    const derived = ctx.sessions.deriveMessages(session!)
    expect(derived).toEqual([
      { role: 'user', content: 'please echo' },
      {
        role: 'assistant',
        content: [{
          type: 'tool-call',
          id: 'call-1',
          name: 'echo',
          arguments: '{"value":"hi"}',
        }],
      },
      {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call-1',
          content: 'echo:hi',
          isError: false,
        }],
      },
      { role: 'assistant', content: 'done' },
    ])

    expect(requests).toHaveLength(2)
    expect(requests[0]?.messages).toEqual([
      { role: 'system', content: expect.stringContaining('coridis') },
      { role: 'user', content: 'please echo' },
    ])
    expect(requests[0]?.tools?.map(tool => tool.name)).toEqual(['echo'])
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-1',
        content: 'echo:hi',
        isError: false,
      }],
    })

    await handle.dispose()
    expect(ctx.agents.get(agent.id)).toBeUndefined()
  })

  it('records malformed tool arguments as an empty object for the tool to reject', async () => {
    const { ctx } = await mount((_request, call) => call === 1
      ? [
          {
            type: 'tool-call',
            call: { type: 'tool-call', id: 'bad', name: 'echo', arguments: '{broken' },
          },
          { type: 'finish', reason: 'tool-calls' },
        ]
      : [
          { type: 'text-delta', text: 'recovered' },
          { type: 'finish', reason: 'stop' },
        ])
    const handle = await ctx.agents.create({})
    handle.agent.followup('go')
    await handle.agent.whenIdle()

    const session = ctx.sessions.get(handle.agent.sessionId)!
    const result = session.events.find(event => event.type === 'tool/result')
    expect(result).toMatchObject({
      type: 'tool/result',
      data: { callId: 'bad', isError: true },
    })
    expect(String((result as { data: { content: string } }).data.content))
      .toContain('"value" must be a non-empty string')
  })

  it('records a fatal adapter error and still closes the turn', async () => {
    const { ctx } = await mount(() => {
      throw new Error('provider down')
    })
    const handle = await ctx.agents.create({})
    handle.agent.followup('fail')
    await handle.agent.whenIdle()

    expect(handle.agent.lastError?.message).toBe('provider down')
    const session = ctx.sessions.get(handle.agent.sessionId)!
    expect(session.events.map(event => event.type)).toEqual([
      'turn/start',
      'user/message',
      'step/start',
      'prompt/assembled',
      'step/end',
      'run/error',
      'turn/end',
    ])
    expect(session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { status: 'error' },
    })
  })

  it('fails the turn when the step limit is reached', async () => {
    const { ctx } = await mount(() => [
      {
        type: 'tool-call',
        call: { type: 'tool-call', id: 'again', name: 'echo', arguments: '{"value":"x"}' },
      },
      { type: 'finish', reason: 'tool-calls' },
    ], { maxSteps: 2 })
    const handle = await ctx.agents.create({})
    handle.agent.followup('loop')
    await handle.agent.whenIdle()

    const session = ctx.sessions.get(handle.agent.sessionId)!
    expect(session.events.filter(event => event.type === 'step/start')).toHaveLength(2)
    expect(handle.agent.lastError?.message).toContain('step limit reached after 2 steps')
    expect(session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { status: 'error' },
    })
  })

  it('rejects followups after the agent is disposed', async () => {
    const { ctx } = await mount(() => {
      throw new Error('unused')
    })
    const handle = await ctx.agents.create({})
    await handle.dispose()
    expect(() => handle.agent.followup('late')).toThrow(/has been disposed/)
  })
})

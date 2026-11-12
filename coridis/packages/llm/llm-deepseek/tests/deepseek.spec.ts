import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LlmService } from '@coridis/llm'
import type { StreamChunk } from '@coridis/llm'
import * as deepseek from '../src/index.ts'

async function mount(config: Partial<deepseek.Config> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmService)
  await ctx.plugin(deepseek, {
    model: 'deepseek-chat',
    baseURL: 'https://deepseek.test',
    ...config,
  })
  return ctx
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('DeepSeek adapter', () => {
  it('maps messages, tools, text, and tool calls over the wire', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'secret')
    const fetchMock = vi.fn(async () => jsonResponse({
      choices: [{
        message: {
          content: 'Let me check.',
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'read', arguments: '{"path":"a.txt"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await mount()

    const chunks = await collect(ctx.llm.stream({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Read a.txt.' },
        {
          role: 'assistant',
          content: [{
            type: 'tool-call',
            id: 'old',
            name: 'read',
            arguments: '{"path":"old.txt"}',
          }],
        },
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'old',
            content: 'missing',
            isError: true,
          }],
        },
      ],
      tools: [{
        name: 'read',
        description: 'Read a file.',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      }],
    }))

    expect(chunks).toEqual([
      { type: 'text-delta', text: 'Let me check.' },
      {
        type: 'tool-call',
        call: { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"a.txt"}' },
      },
      { type: 'finish', reason: 'tool-calls' },
    ])

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://deepseek.test/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret')
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ model: 'deepseek-chat', stream: false })
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Read a.txt.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'old',
          type: 'function',
          function: { name: 'read', arguments: '{"path":"old.txt"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'old', content: 'Error: missing' },
    ])
    expect(body.tools).toEqual([{
      type: 'function',
      function: {
        name: 'read',
        description: 'Read a file.',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    }])
  })

  it('declares its model', async () => {
    const ctx = await mount()

    expect(ctx.llm.models()).toEqual(['deepseek-chat'])
    expect(ctx.llm.listAdapters()).toEqual(['deepseek'])
  })

  it('maps plain stops and drops an empty assistant text block', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'secret')
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
    })))
    const ctx = await mount()

    expect(await collect(ctx.llm.stream({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
    }))).toEqual([{ type: 'finish', reason: 'stop' }])
  })

  it('requires the configured API key', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await mount()

    await expect(collect(ctx.llm.stream({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
    }))).rejects.toThrow(/API key is missing: set DEEPSEEK_API_KEY/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces HTTP and invalid-JSON failures', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'secret')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })))
    const ctx = await mount()
    await expect(collect(ctx.llm.stream({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
    }))).rejects.toThrow(/DeepSeek request failed \(429\): rate limited/)

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })))
    await expect(collect(ctx.llm.stream({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
    }))).rejects.toThrow(/invalid JSON/)
  })

  it('surfaces provider errors and an absent choice', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'secret')
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'bad key' } })))
    const ctx = await mount()
    await expect(collect(ctx.llm.stream({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
    }))).rejects.toThrow(/DeepSeek error: bad key/)

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ choices: [] })))
    await expect(collect(ctx.llm.stream({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
    }))).rejects.toThrow(/no choices/)
  })
})

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LlmService } from '../src/index.ts'
import type { LlmAdapter, StreamChunk, StreamRequest } from '../src/index.ts'

async function mount(): Promise<{ ctx: Context; llm: LlmService }> {
  const ctx = new Context()
  await ctx.plugin(LlmService)
  return { ctx, llm: ctx.llm }
}

function adapter(id: string, models: string[], chunks: readonly StreamChunk[]): LlmAdapter {
  return {
    id,
    models,
    async *stream() {
      for (const chunk of chunks) yield chunk
    },
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

const request: StreamRequest = { model: 'model-a', messages: [{ role: 'user', content: 'hi' }] }
const chunks: StreamChunk[] = [
  { type: 'text-delta', text: 'hello' },
  { type: 'finish', reason: 'stop' },
]

describe('LlmService', () => {
  it('selects an adapter by model and streams its chunks', async () => {
    const { llm } = await mount()
    llm.registerAdapter(adapter('a', ['model-a'], chunks))
    llm.registerAdapter(adapter('b', ['model-b'], [{ type: 'finish', reason: 'length' }]))

    expect(llm.listAdapters()).toEqual(['a', 'b'])
    expect(llm.models()).toEqual(['model-a', 'model-b'])
    expect(await collect(llm.stream(request))).toEqual(chunks)
  })

  it('rejects duplicate adapter ids and overlapping models', async () => {
    const { llm } = await mount()
    llm.registerAdapter(adapter('a', ['model-a'], chunks))

    expect(() => llm.registerAdapter(adapter('a', ['other'], chunks)))
      .toThrow(/already registered/)
    expect(() => llm.registerAdapter(adapter('b', ['model-a'], chunks)))
      .toThrow(/model "model-a" is already served by adapter "a"/)
  })

  it('reports the registered adapters when no model is served', async () => {
    const { llm } = await mount()
    expect(() => llm.stream(request))
      .toThrow(/no llm adapter serves model "model-a" \(no adapter is registered\)/)

    llm.registerAdapter(adapter('a', ['model-a'], chunks))
    expect(() => llm.stream({ ...request, model: 'missing' }))
      .toThrow(/registered adapters: a/)
  })

  it('unregisters adapters through the disposer', async () => {
    const { llm } = await mount()
    const dispose = llm.registerAdapter(adapter('a', ['model-a'], chunks))
    dispose()
    expect(llm.listAdapters()).toEqual([])
    expect(() => llm.stream(request)).toThrow(/no adapter is registered/)
  })

  it('passes the request to the adapter unchanged', async () => {
    const { llm } = await mount()
    let seen: StreamRequest | undefined
    llm.registerAdapter({
      id: 'a',
      models: ['model-a'],
      async *stream(current) {
        seen = current
        yield { type: 'finish', reason: 'stop' }
      },
    })

    const tools = [{ name: 'read', description: 'Read.', parameters: { type: 'object' } }]
    const signal = new AbortController().signal
    const incoming = { ...request, tools, signal }
    await collect(llm.stream(incoming))

    expect(seen).toBe(incoming)
  })

  it('lets a waterfall listener wrap the selected stream', async () => {
    const { ctx, llm } = await mount()
    llm.registerAdapter(adapter('a', ['model-a'], chunks))
    ctx.on('llm/stream', (_request, next) => (async function* () {
      yield { type: 'text-delta' as const, text: 'prefix:' }
      yield* next()
    })())

    const result = await collect(llm.stream(request))
    expect(result[0]).toEqual({ type: 'text-delta', text: 'prefix:' })
    expect(result).toHaveLength(3)
  })

  it('propagates adapter failures without wrapping them', async () => {
    const { llm } = await mount()
    const failure = new Error('provider down')
    llm.registerAdapter({
      id: 'a',
      models: ['model-a'],
      async *stream() {
        throw failure
      },
    })

    await expect(collect(llm.stream(request))).rejects.toBe(failure)
  })
})

import { describe, expect, it } from 'vitest'
import { assembleChunks, assembleStream } from '../src/index.ts'
import type { StreamChunk } from '../src/index.ts'

const call = {
  type: 'tool-call' as const,
  call: { type: 'tool-call' as const, id: 'c1', name: 'read', arguments: '{}' },
}

describe('assembleChunks', () => {
  it('collects text, tool calls, and the finish reason', () => {
    const record = assembleChunks([
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
      call,
      { type: 'finish', reason: 'tool-calls' },
    ])

    expect(record.text).toBe('Hello')
    expect(record.toolCalls).toEqual([call.call])
    expect(record.reason).toBe('tool-calls')
    expect(record.chunks).toHaveLength(4)
  })

  it('requires a finish chunk', () => {
    expect(() => assembleChunks([{ type: 'text-delta', text: 'partial' }]))
      .toThrow(/without a finish chunk/)
  })
})

describe('assembleStream', () => {
  it('consumes an async stream into a record', async () => {
    const record = await assembleStream((async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text-delta', text: 'a' }
      yield { type: 'text-delta', text: 'b' }
      yield { type: 'finish', reason: 'stop' }
    })())

    expect(record.text).toBe('ab')
    expect(record.reason).toBe('stop')
  })
})

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRegistry } from '@coridis/agent'
import * as agentLoop from '@coridis/agent-loop'
import { LlmService } from '@coridis/llm'
import type { LlmAdapter, StreamChunk } from '@coridis/llm'
import { SessionStore } from '@coridis/session'
import { SystemPromptService } from '@coridis/system-prompt'
import { ToolsService } from '@coridis/tools'
import * as headless from '../src/index.ts'
import * as startup from '../src/startup.ts'

async function mountRunner(options: {
  task: string
  json: boolean
  chunks?: readonly StreamChunk[]
  fail?: boolean
}): Promise<{ ctx: Context; writes: string[] }> {
  const ctx = new Context()
  const adapter: LlmAdapter = {
    id: 'fake',
    models: ['fake-model'],
    async *stream() {
      if (options.fail) throw new Error('model failed')
      for (const chunk of options.chunks ?? [
        { type: 'text-delta', text: 'answer' },
        { type: 'finish', reason: 'stop' },
      ]) {
        yield chunk
      }
    },
  }

  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmService)
  await ctx.plugin(SystemPromptService)
  await ctx.plugin(ToolsService)
  await ctx.plugin(AgentRegistry)
  ctx.llm.registerAdapter(adapter)
  await ctx.plugin(agentLoop, { model: 'fake-model', maxSteps: 2 })
  await ctx.plugin(startup, { task: options.task, json: options.json })

  const writes: string[] = []
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    writes.push(String(chunk))
    return true
  })
  try {
    await ctx.plugin(headless)
    await ctx.headlessRun.done
  } finally {
    write.mockRestore()
  }
  return { ctx, writes }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('headless runner', () => {
  it('runs one task, prints the final answer, and disposes the agent', async () => {
    const { ctx, writes } = await mountRunner({ task: 'say hi', json: false })
    const result = await ctx.headlessRun.done

    expect(result).toMatchObject({ text: 'answer' })
    expect(result.sessionId).not.toBe('')
    expect(result.error).toBeUndefined()
    expect(writes.join('')).toBe('answer\n')
    expect(ctx.agents.list()).toEqual([])

    const session = ctx.sessions.get(result.sessionId)
    expect(session?.events.map(event => event.type)).toContain('turn/start')
    expect(session?.events.at(-1)?.type).toBe('turn/end')
  })

  it('emits NDJSON Session events without final text in json mode', async () => {
    const { ctx, writes } = await mountRunner({ task: 'say hi', json: true })
    const result = await ctx.headlessRun.done

    expect(result.text).toBe('')
    expect(result.error).toBeUndefined()
    const events = writes.flatMap(line => line.trim() === '' ? [] : [JSON.parse(line)])
    expect(events.map(event => event.type)).toContain('turn/start')
    expect(events.map(event => event.type)).toContain('assistant/message')
    expect(events.every(event => event.sessionId === result.sessionId)).toBe(true)
    expect(events.map(event => event.seq)).toEqual(events.map((_event, index) => index))
  })

  it('reports a model failure through the run result', async () => {
    const { ctx, writes } = await mountRunner({ task: 'fail', json: false, fail: true })
    const result = await ctx.headlessRun.done

    expect(result.error?.message).toBe('model failed')
    expect(result.text).toBe('')
    expect(writes.join('')).toBe('')
    expect(ctx.agents.list()).toEqual([])
  })
})

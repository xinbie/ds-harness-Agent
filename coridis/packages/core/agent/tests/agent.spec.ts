import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { AgentRegistry } from '../src/index.ts'
import type { Agent, AgentHandle } from '../src/index.ts'

function fakeAgent(id: string): Agent {
  return {
    id,
    sessionId: `session-${id}`,
    status: 'idle',
    followup() {},
    async whenIdle() {},
    lastError: undefined,
  }
}

function fakeFactory(agent: Agent): { create: () => Promise<AgentHandle>; disposals: string[] } {
  const disposals: string[] = []
  return {
    disposals,
    async create() {
      return {
        agent,
        async dispose() {
          disposals.push(agent.id)
        },
      }
    },
  }
}

async function mount(): Promise<AgentRegistry> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  return ctx.agents
}

describe('AgentRegistry', () => {
  it('requires a factory and delegates creation to the latest one', async () => {
    const agents = await mount()
    await expect(agents.create()).rejects.toThrow(/no agent factory is registered/)

    const first = fakeFactory(fakeAgent('first'))
    const dispose = agents.registerFactory(first)
    const handle = await agents.create()
    expect(handle.agent.id).toBe('first')
    expect(agents.get('first')).toBe(handle.agent)
    expect(agents.list()).toEqual([handle.agent])

    dispose()
    await expect(agents.create()).rejects.toThrow(/no agent factory is registered/)
  })

  it('removes an agent from the registry when its handle is disposed', async () => {
    const agents = await mount()
    const factory = fakeFactory(fakeAgent('one'))
    agents.registerFactory(factory)
    const handle = await agents.create()

    await handle.dispose()
    expect(agents.get('one')).toBeUndefined()
    expect(agents.list()).toEqual([])
    expect(factory.disposals).toEqual(['one'])
  })

  it('rejects duplicate live agent ids and disposes the new handle', async () => {
    const agents = await mount()
    const agent = fakeAgent('same')
    const factory = fakeFactory(agent)
    agents.registerFactory(factory)
    await agents.create()

    await expect(agents.create()).rejects.toThrow(/already exists/)
    expect(factory.disposals).toEqual(['same'])
  })

  it('unwinds creation when an agent/created listener fails', async () => {
    const agents = await mount()
    const factory = fakeFactory(fakeAgent('fragile'))
    agents.registerFactory(factory)
    const ctx = (agents as unknown as { ctx: Context }).ctx
    ctx.on('agent/created', () => {
      throw new Error('listener failed')
    })

    await expect(agents.create()).rejects.toThrow(/listener failed/)
    expect(agents.get('fragile')).toBeUndefined()
    expect(factory.disposals).toEqual(['fragile'])
  })
})

/**
 * Agent interface, live registry, and the `agent/*` event vocabulary. Concrete
 * creation and driving belong to `@coridis/agent-loop`.
 *
 * @module @coridis/agent
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentStatus, CreateAgentOptions } from './types.ts'

export * from './types.ts'

/** Live Agent registry; registered as `ctx.agents`. */
export class AgentRegistry extends Service {
  private readonly agents = new Map<string, Agent>()
  private factory: AgentFactory | undefined

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  /** Install the factory that implements `create`; last registration wins. */
  registerFactory(factory: AgentFactory): () => void {
    return this.ctx.effect(() => {
      const previous = this.factory
      this.factory = factory
      return () => {
        if (this.factory === factory) this.factory = previous
      }
    }, 'ctx.agents.registerFactory()')
  }

  /** Delegate creation to the mounted AgentFactory. */
  async create(options: CreateAgentOptions = {}): Promise<AgentHandle> {
    const factory = this.factory
    if (factory === undefined) {
      throw new Error('no agent factory is registered')
    }
    const handle = await factory.create(options)
    if (this.agents.has(handle.agent.id)) {
      await handle.dispose()
      throw new Error(`agent "${handle.agent.id}" already exists`)
    }
    this.agents.set(handle.agent.id, handle.agent)
    try {
      await this.ctx.serial('agent/created', { agent: handle.agent })
    } catch (error) {
      this.agents.delete(handle.agent.id)
      await handle.dispose()
      throw error
    }
    return {
      agent: handle.agent,
      dispose: async () => {
        this.agents.delete(handle.agent.id)
        await handle.dispose()
      },
    }
  }

  /** Resolve a live Agent by id. */
  get(id: string): Agent | undefined {
    return this.agents.get(id)
  }

  /** List live Agents. */
  list(): readonly Agent[] {
    return [...this.agents.values()]
  }
}

/** The seam through which the loop implements `agents.create`. */
export interface AgentFactory {
  create(options: CreateAgentOptions): Promise<AgentHandle>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agents: AgentRegistry
  }

  interface Events {
    /** An Agent entered the registry; awaited before creation resolves. @mode serial */
    'agent/created'(payload: {
      readonly agent: Agent
      readonly signal?: AbortSignal
    }): undefined | Promise<undefined>

    /** An Agent changed status. @mode emit */
    'agent/status'(payload: {
      readonly agent: Agent
      readonly status: AgentStatus
    }): void

    /** One message entered the live inbox. @mode emit */
    'agent/inbox/inserted'(payload: {
      readonly agent: Agent
      readonly message: string
    }): void

    /** Waterfall over the messages claimed for one proposed step. @mode waterfall */
    'agent/pre-step'(
      payload: { readonly agent: Agent },
      next: () => Promise<readonly string[]>,
    ): Promise<readonly string[]>
  }
}

/** Cordis mounts the service class directly. */
export default AgentRegistry

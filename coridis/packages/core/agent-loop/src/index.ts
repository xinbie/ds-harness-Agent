/**
 * The concrete turn/step driver. It creates scoped Agents, publishes them
 * through `ctx.agents`, and owns their ordered teardown. This is a consumer of
 * `ctx.agents`, `ctx.sessions`, `ctx.llm`, `ctx.tools`, and `ctx.systemPrompt`.
 *
 * @module @coridis/agent-loop
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {
  Agent,
  AgentHandle,
  AgentStatus,
  CreateAgentOptions,
} from '@coridis/agent'
import type { ToolCallBlock } from '@coridis/llm'
import { createSessionId } from '@coridis/session'
import type { Session } from '@coridis/session'
import { toToolSchema } from '@coridis/tools'
import type { ToolExecution, ToolExecutionResult } from '@coridis/tools'
import type {} from '@coridis/system-prompt'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'agent-loop'

/** Services that must exist before the driver can start. */
export const inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt']

/** Driver configuration. */
export interface Config {
  /** Hard cap on steps inside one turn. Defaults to 24. */
  readonly maxSteps?: number
  /** Maximum tool calls executed concurrently inside one step. Defaults to 4. */
  readonly maxParallelToolCalls?: number
  /** Model id requested from `ctx.llm`. Defaults to `deepseek-chat`. */
  readonly model?: string
}

/** Install the AgentFactory that drives turns and steps. */
export function apply(ctx: Context, config: Config = {}): void {
  const loop = new AgentLoop(new LoopSettings(config))
  ctx.effect(() => ctx.agents.registerFactory({
    create: options => loop.create(ctx, options),
  }), 'agent-loop.factory')
}

class LoopSettings {
  readonly maxSteps: number
  readonly maxParallelToolCalls: number
  readonly model: string

  constructor(config: Config) {
    this.maxSteps = Math.max(1, Math.floor(config.maxSteps ?? 24))
    this.maxParallelToolCalls = Math.max(1, Math.floor(config.maxParallelToolCalls ?? 4))
    this.model = config.model ?? 'deepseek-chat'
  }
}

class AgentLoop {
  constructor(private readonly settings: LoopSettings) {}

  async create(ctx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
    const id = options.sessionId ?? createSessionId()
    let session = ctx.sessions.get(id)
    if (session === undefined) {
      session = ctx.sessions.create({
        id,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      })
    }
    const agent = new LoopAgent(ctx, this.settings, session)
    return {
      agent,
      dispose: () => agent.dispose(),
    }
  }
}

class LoopAgent implements Agent {
  readonly id = `agent-${randomUUID()}`
  readonly sessionId: string
  status: AgentStatus = 'idle'

  private error: Error | undefined
  private readonly inbox: string[] = []
  private readonly idleWaiters: (() => void)[] = []
  private readonly abortController = new AbortController()
  private running = false
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly settings: LoopSettings,
    private readonly session: Session,
  ) {
    this.sessionId = session.id
  }

  followup(message: string): void {
    if (this.disposed) throw new Error('agent has been disposed')
    this.inbox.push(message)
    this.ctx.emit('agent/inbox/inserted', { agent: this, message })
    this.kick()
  }

  whenIdle(): Promise<void> {
    if (!this.running && this.inbox.length === 0) return Promise.resolve()
    return new Promise(resolve => this.idleWaiters.push(resolve))
  }

  get lastError(): Error | undefined {
    return this.error
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.inbox.length = 0
    this.abortController.abort()
    await this.whenIdle()
  }

  private get signal(): AbortSignal {
    return this.abortController.signal
  }

  private setStatus(status: AgentStatus): void {
    if (this.status === status) return
    this.status = status
    this.ctx.emit('agent/status', { agent: this, status })
  }

  private kick(): void {
    if (this.running || this.disposed || this.inbox.length === 0) return
    void this.drain()
  }

  private async drain(): Promise<void> {
    this.running = true
    this.setStatus('running')
    try {
      while (!this.disposed && this.inbox.length > 0) {
        const messages = await this.ctx.waterfall(
          'agent/pre-step',
          { agent: this },
          async () => this.inbox.splice(0),
        )
        if (messages.length === 0) continue
        await this.runTurn(messages)
      }
    } catch (error) {
      this.error = toError(error)
    } finally {
      this.running = false
      this.setStatus('idle')
      if (!this.disposed && this.inbox.length > 0) {
        this.kick()
        return
      }
      if (this.inbox.length === 0) this.flushIdle()
    }
  }

  private flushIdle(): void {
    for (const resolve of this.idleWaiters.splice(0)) resolve()
  }

  private async runTurn(input: readonly string[]): Promise<void> {
    const turnId = randomUUID()
    this.session.append({ type: 'turn/start', data: { turnId, input } })
    for (const text of input) {
      this.session.append({ type: 'user/message', data: { text } })
    }

    let status: 'completed' | 'error' | 'aborted' = 'completed'
    let openStep: number | undefined
    let owed = false
    let completed = false

    try {
      for (let step = 1; step <= this.settings.maxSteps; step++) {
        if (this.signal.aborted) {
          status = 'aborted'
          break
        }

        openStep = step
        this.session.append({ type: 'step/start', data: { turnId, step } })

        const prompt = await this.ctx.systemPrompt.assemble({
          scope: this as object,
          tools: this.ctx.tools.list(this as object).map(toToolSchema),
        })
        this.session.append({
          type: 'prompt/assembled',
          data: {
            turnId,
            step,
            system: prompt.system,
            tools: prompt.tools.map(tool => tool.name),
          },
        })

        const messages = [
          { role: 'system' as const, content: prompt.system },
          ...this.ctx.sessions.deriveMessages(this.session),
        ]

        let text = ''
        const calls: ToolCallBlock[] = []
        let reason: 'stop' | 'tool-calls' | 'length' | 'error' = 'stop'
        for await (const chunk of this.ctx.llm.stream({
          model: this.settings.model,
          messages,
          tools: prompt.tools,
          signal: this.signal,
        })) {
          if (chunk.type === 'text-delta') {
            text += chunk.text
          } else if (chunk.type === 'tool-call') {
            calls.push(chunk.call)
          } else {
            reason = chunk.reason
          }
        }
        owed = false

        this.session.append({
          type: 'assistant/message',
          data: {
            text,
            toolCalls: calls.map(call => ({
              id: call.id,
              name: call.name,
              arguments: call.arguments,
            })),
          },
        })
        this.session.append({ type: 'step/end', data: { turnId, step, reason } })
        openStep = undefined

        if (calls.length === 0 || reason === 'length') {
          completed = true
          break
        }
        owed = true

        for (const call of calls) {
          this.session.append({
            type: 'tool/call',
            data: { callId: call.id, name: call.name, arguments: call.arguments },
          })
        }

        const executions: ToolExecution[] = calls.map(call => ({
          name: call.name,
          args: parseArguments(call.arguments),
          agent: this,
          signal: this.signal,
        }))
        const results = await this.ctx.tools.execute(executions, {
          maxParallel: this.settings.maxParallelToolCalls,
        })
        for (let index = 0; index < calls.length; index++) {
          const call = calls[index]
          const result = results[index]
          if (call === undefined || result === undefined) continue
          this.session.append({
            type: 'tool/result',
            data: {
              callId: call.id,
              name: call.name,
              content: renderResult(result),
              isError: result.isError,
            },
          })
        }
      }

      if (!completed && status === 'completed' && owed) {
        const error = new Error(`step limit reached after ${this.settings.maxSteps} steps`)
        this.error = error
        status = 'error'
        this.session.append({
          type: 'run/error',
          data: { message: error.message, stack: error.stack ?? '' },
        })
      }
    } catch (error) {
      const normalized = toError(error)
      this.error = normalized
      status = this.signal.aborted ? 'aborted' : 'error'
      if (openStep !== undefined) {
        this.session.append({ type: 'step/end', data: { turnId, step: openStep, reason: 'error' } })
        openStep = undefined
      }
      this.session.append({
        type: 'run/error',
        data: { message: normalized.message, stack: normalized.stack ?? '' },
      })
    } finally {
      this.session.append({ type: 'turn/end', data: { turnId, status } })
    }
  }
}

function parseArguments(raw: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Fall through to an empty argument object; the tool validates it.
  }
  return {}
}

function renderResult(result: ToolExecutionResult): string {
  return result.content
    .map(block => block.type === 'text' ? block.text : `[image: ${block.mimeType}]`)
    .join('\n')
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

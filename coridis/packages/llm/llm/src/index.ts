/**
 * Model-adapter seam. `ctx.llm` owns adapter registration and streaming; which
 * provider serves a model is configuration, not a compile-time dependency.
 *
 * @module @coridis/llm
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { LlmAdapter, StreamChunk, StreamRequest } from './types.ts'

export * from './types.ts'
export { assembleChunks, assembleStream } from './assembler.ts'
export type { AssistantStreamRecord } from './assembler.ts'

/** Model service; registered as `ctx.llm`. */
export class LlmService extends Service {
  private readonly adapters = new Map<string, LlmAdapter>()

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  /** Register an adapter; reject duplicate ids and overlapping models. */
  registerAdapter(adapter: LlmAdapter): () => void {
    return this.ctx.effect(() => {
      if (this.adapters.has(adapter.id)) {
        throw new Error(`llm adapter "${adapter.id}" is already registered`)
      }
      for (const existing of this.adapters.values()) {
        for (const model of adapter.models) {
          if (existing.models.includes(model)) {
            throw new Error(
              `llm model "${model}" is already served by adapter "${existing.id}"`,
            )
          }
        }
      }
      this.adapters.set(adapter.id, adapter)
      return () => {
        if (this.adapters.get(adapter.id) === adapter) this.adapters.delete(adapter.id)
      }
    }, `ctx.llm.registerAdapter(${JSON.stringify(adapter.id)})`)
  }

  /** Select the adapter for a model and stream through `llm/stream`. */
  stream(request: StreamRequest): AsyncIterable<StreamChunk> {
    const adapter = this.resolve(request.model)
    return this.ctx.waterfall('llm/stream', request, () => adapter.stream(request))
  }

  /** Adapter ids currently registered, for diagnostics. */
  listAdapters(): readonly string[] {
    return [...this.adapters.keys()]
  }

  /** Every model currently served, in registration order. */
  models(): readonly string[] {
    const models: string[] = []
    for (const adapter of this.adapters.values()) models.push(...adapter.models)
    return models
  }

  private resolve(model: string): LlmAdapter {
    for (const adapter of this.adapters.values()) {
      if (adapter.models.includes(model)) return adapter
    }
    const registered = this.listAdapters()
    const suffix = registered.length === 0
      ? 'no adapter is registered'
      : `registered adapters: ${registered.join(', ')}`
    throw new Error(`no llm adapter serves model "${model}" (${suffix})`)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    llm: LlmService
  }

  interface Events {
    /**
     * Waterfall around one model call; wrappers implement recording, metrics,
     * and provider substitution. Must call `next()` to delegate.
     * @mode waterfall
     */
    'llm/stream'(
      request: StreamRequest,
      next: () => AsyncIterable<StreamChunk>,
    ): AsyncIterable<StreamChunk>
  }
}

/** Cordis mounts the service class directly. */
export default LlmService

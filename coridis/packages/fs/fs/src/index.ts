/**
 * Filesystem capability seam (`ctx.fs`). It owns the provider registry and the
 * execution-world operations; it never assumes the local disk is the world.
 *
 * @module @coridis/fs
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { FsProvider, FsStat } from './types.ts'

export * from './types.ts'

/** Filesystem service configuration. */
export interface Config {
  /** Provider id to read through; required when several are registered. */
  readonly provider?: string
}

/** Filesystem service; registered as `ctx.fs`. */
export class FsService extends Service {
  private readonly providers = new Map<string, FsProvider>()

  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'fs')
  }

  /** Register a provider; reject duplicate ids; return the disposer. */
  registerProvider(provider: FsProvider): () => void {
    if (provider.id.trim() === '') {
      throw new Error('fs provider id must not be empty')
    }
    return this.ctx.effect(() => {
      if (this.providers.has(provider.id)) {
        throw new Error(`fs provider "${provider.id}" is already registered`)
      }
      this.providers.set(provider.id, provider)
      return () => {
        if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id)
      }
    }, `ctx.fs.registerProvider(${JSON.stringify(provider.id)})`)
  }

  /** Expose the configured provider, or the sole registered one. */
  get provider(): FsProvider | undefined {
    if (this.config.provider !== undefined) {
      return this.providers.get(this.config.provider)
    }
    if (this.providers.size > 1) return undefined
    return this.providers.values().next().value
  }

  /** Stat through the selected provider. */
  async stat(path: string): Promise<FsStat> {
    return this.requireProvider().stat(path)
  }

  /** Read text through the selected provider. */
  async readText(path: string): Promise<string> {
    const text = await this.requireProvider().readText(path)
    this.ctx.emit('fs/observed', { path })
    return text
  }

  private requireProvider(): FsProvider {
    if (this.config.provider !== undefined) {
      const provider = this.providers.get(this.config.provider)
      if (provider === undefined) {
        throw new Error(`configured fs provider "${this.config.provider}" is not registered`)
      }
      return provider
    }
    if (this.providers.size === 0) {
      throw new Error('no fs provider is registered')
    }
    if (this.providers.size > 1) {
      const ids = [...this.providers.keys()].join(', ')
      throw new Error(
        `multiple fs providers are registered (${ids}); configure one or remove the others`,
      )
    }
    return this.providers.values().next().value!
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fs: FsService
  }

  interface Events {
    /** A read was observed; policies may journal or redact it. @mode emit */
    'fs/observed'(payload: { readonly path: string }): void
  }
}

/** Cordis mounts the service class directly. */
export default FsService

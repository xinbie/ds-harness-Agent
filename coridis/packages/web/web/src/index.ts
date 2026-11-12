/**
 * Web access capability seam (`ctx.web`). It owns provider registries and
 * execution-time selection; the tools never import a concrete provider.
 *
 * @module @coridis/web
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from './types.ts'

export * from './types.ts'

/** Web access service configuration. */
export interface Config {
  /** Provider id used for search; required when several are registered. */
  readonly searchProvider?: string
  /** Provider id used for fetch; required when several are registered. */
  readonly fetchProvider?: string
}

/** Web access service; registered as `ctx.web`. */
export class WebRuntime extends Service {
  private readonly searchProviders = new Map<string, WebSearchProvider>()
  private readonly fetchProviders = new Map<string, WebFetchProvider>()

  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'web')
  }

  /** Register a search provider; reject duplicate ids. */
  registerSearchProvider(provider: WebSearchProvider): () => void {
    return this.register(this.searchProviders, provider, 'search')
  }

  /** Register a fetch provider; reject duplicate ids. */
  registerFetchProvider(provider: WebFetchProvider): () => void {
    return this.register(this.fetchProviders, provider, 'fetch')
  }

  /** Select a search provider and execute one search. */
  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    return this.select(this.searchProviders, this.config.searchProvider, 'search').search(request)
  }

  /** Select a fetch provider and execute one fetch. */
  async fetch(request: WebFetchRequest): Promise<WebFetchResult> {
    return this.select(this.fetchProviders, this.config.fetchProvider, 'fetch').fetch(request)
  }

  /** Registered provider ids, for diagnostics. */
  providers(): { readonly search: readonly string[]; readonly fetch: readonly string[] } {
    return {
      search: [...this.searchProviders.keys()],
      fetch: [...this.fetchProviders.keys()],
    }
  }

  private select<T extends { readonly id: string }>(
    registry: Map<string, T>,
    configured: string | undefined,
    kind: 'search' | 'fetch',
  ): T {
    if (configured !== undefined) {
      const provider = registry.get(configured)
      if (provider === undefined) {
        throw new WebError(
          'WEB_PROVIDER_CONFIGURED_MISSING',
          `configured web ${kind} provider "${configured}" is not registered`,
        )
      }
      return provider
    }
    if (registry.size === 0) {
      throw new WebError('WEB_PROVIDER_UNAVAILABLE', `no web ${kind} provider is registered`)
    }
    if (registry.size > 1) {
      const ids = [...registry.keys()].join(', ')
      throw new WebError(
        'WEB_PROVIDER_AMBIGUOUS',
        `multiple web ${kind} providers are registered (${ids}); configure one or remove the others`,
      )
    }
    return registry.values().next().value!
  }

  private register<T extends { readonly id: string }>(
    registry: Map<string, T>,
    provider: T,
    kind: 'search' | 'fetch',
  ): () => void {
    if (provider.id.trim() === '') {
      throw new Error(`web ${kind} provider id must not be empty`)
    }
    return this.ctx.effect(() => {
      if (registry.has(provider.id)) {
        throw new WebError(
          'WEB_DUPLICATE_PROVIDER',
          `web ${kind} provider "${provider.id}" is already registered`,
        )
      }
      registry.set(provider.id, provider)
      return () => {
        if (registry.get(provider.id) === provider) registry.delete(provider.id)
      }
    }, `ctx.web.register${kind === 'search' ? 'Search' : 'Fetch'}Provider(${JSON.stringify(provider.id)})`)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    web: WebRuntime
  }
}

/**
 * Structured failure for provider selection and execution. Codes stay stable
 * so tools can render a typed error instead of a provider-specific message.
 */
export class WebError extends Error {
  override readonly name = 'WebError'

  constructor(
    readonly code:
      | 'WEB_PROVIDER_CONFIGURED_MISSING'
      | 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE'
      | 'WEB_PROVIDER_AMBIGUOUS'
      | 'WEB_PROVIDER_UNAVAILABLE'
      | 'WEB_DUPLICATE_PROVIDER',
    message: string,
  ) {
    super(message)
  }
}

/** Cordis mounts the service class directly. */
export default WebRuntime

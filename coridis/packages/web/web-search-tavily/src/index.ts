/**
 * Tavily search provider for `ctx.web`. A Service Provider only: it maps the
 * neutral request to Tavily's HTTP API and back.
 *
 * @module @coridis/web-search-tavily
 */

import type { Context } from '@deepseek-ai/cordis'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@coridis/web'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-tavily'

/** The seam this provider registers into. */
export const inject = ['web']

/** Provider configuration. */
export interface Config {
  /** Provider id. Defaults to `tavily`. */
  readonly id?: string
  /** Environment variable holding the API key. Defaults to `TAVILY_API_KEY`. */
  readonly apiKeyEnv?: string
  /** Endpoint base URL. Defaults to `https://api.tavily.com`. */
  readonly baseURL?: string
}

/** Register the Tavily search provider on `ctx.web`. */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = createProvider(config)
  ctx.effect(() => ctx.web.registerSearchProvider(provider), 'web-search-tavily.provide')
}

function createProvider(config: Config): WebSearchProvider {
  const id = config.id ?? 'tavily'
  const apiKeyEnv = config.apiKeyEnv ?? 'TAVILY_API_KEY'
  const baseURL = (config.baseURL ?? 'https://api.tavily.com').replace(/\/+$/, '')

  return {
    id,
    async search(request: WebSearchRequest): Promise<WebSearchResult> {
      const apiKey = process.env[apiKeyEnv]
      if (!apiKey) {
        throw new Error(`Tavily API key is missing: set ${apiKeyEnv}`)
      }

      const response = await fetch(`${baseURL}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: request.query,
          max_results: Math.max(1, request.maxResults ?? 5),
          search_depth: 'basic',
        }),
        ...(request.signal ? { signal: request.signal } : {}),
      })

      const text = await response.text()
      if (!response.ok) {
        throw new Error(`Tavily search failed (${response.status}): ${truncate(text)}`)
      }

      let data: TavilyResponse
      try {
        data = JSON.parse(text) as TavilyResponse
      } catch {
        throw new Error(`Tavily returned invalid JSON: ${truncate(text)}`)
      }

      return {
        sources: (data.results ?? [])
          .filter(result => typeof result.url === 'string' && result.url !== '')
          .map(result => ({
            title: result.title ?? result.url ?? '',
            url: result.url ?? '',
            ...(typeof result.content === 'string' && result.content !== ''
              ? { snippet: result.content }
              : {}),
          })),
      }
    },
  }
}

interface TavilyResponse {
  readonly results?: readonly {
    readonly title?: string
    readonly url?: string
    readonly content?: string
  }[]
}

function truncate(text: string, limit = 500): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

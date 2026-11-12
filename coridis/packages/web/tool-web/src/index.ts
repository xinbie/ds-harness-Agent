/**
 * Model-facing `web_search` and `web_fetch` tools over `ctx.web`. This package
 * owns schemas, validation, limits, and presentation, never a concrete
 * provider.
 *
 * @module @coridis/tool-web
 */

import type { Context } from '@deepseek-ai/cordis'
import { SECTION_ORDER } from '@coridis/system-prompt'
import type {} from '@coridis/tools'
import { defineTool } from '@coridis/tools'
import type {} from '@coridis/web'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-web'

/** Services required by the web tool suite. */
export const inject = ['tools', 'web', 'systemPrompt']

/** Plugin configuration. */
export interface Config {
  /** Register `web_search`. Defaults to true. */
  readonly search?: boolean
  /** Register `web_fetch`. Defaults to true. */
  readonly fetch?: boolean
  /** Upper bound on sources returned by one search. */
  readonly searchMaxResults?: number
  /** Cap on returned fetch text characters. */
  readonly fetchMaxOutputChars?: number
}

/** Contribute web guidance and the enabled web tools. */
export function apply(ctx: Context, config: Config = {}): void {
  const searchMaxResults = Math.max(1, Math.floor(config.searchMaxResults ?? 5))
  const fetchMaxOutputChars = Math.max(500, Math.floor(config.fetchMaxOutputChars ?? 200_000))
  const search = config.search ?? true
  const fetch = config.fetch ?? true

  if (search || fetch) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: 'tools/web',
      order: SECTION_ORDER.tools,
      text: [
        search
          ? 'Use `web_search` when you need current information and cite the URLs you used.'
          : '',
        fetch
          ? 'Use `web_fetch` to read a specific page; fetched pages are converted to plain text.'
          : '',
        'Never invent URLs or claim to have opened a page you did not fetch.',
        'Use `read` for local files.',
      ].filter(Boolean).join(' '),
    }))
  }

  if (search) {
    ctx.effect(() => ctx.tools.register(createSearchTool(ctx, searchMaxResults)))
  }
  if (fetch) {
    ctx.effect(() => ctx.tools.register(createFetchTool(ctx, fetchMaxOutputChars)))
  }
}

function createSearchTool(ctx: Context, maxResults: number) {
  return defineTool({
    name: 'web_search',
    description: 'Search the web and return ranked sources with titles, URLs, and snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        max_results: {
          type: 'integer',
          minimum: 1,
          description: `Maximum sources to return. Defaults to and is capped at ${maxResults}.`,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(args) {
      const query = requireString(args, 'query')
      const requested = optionalPositiveInteger(args, 'max_results') ?? maxResults
      const result = await ctx.web.search({
        query,
        maxResults: Math.min(requested, maxResults),
      })
      if (result.sources.length === 0) {
        return { content: [{ type: 'text', text: `No web results for "${query}".` }] }
      }
      const lines = result.sources.map((source, index) => {
        const parts = [`${index + 1}. ${source.title || '(untitled)'}`, `   ${source.url}`]
        if (source.snippet) parts.push(`   ${source.snippet}`)
        return parts.join('\n')
      })
      return { content: [{ type: 'text', text: lines.join('\n\n') }] }
    },
  })
}

function createFetchTool(ctx: Context, maxOutputChars: number) {
  return defineTool({
    name: 'web_fetch',
    description: 'Fetch an http(s) URL and return its readable text plus title.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to fetch.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    async execute(args) {
      const url = requireString(args, 'url')
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw new Error(`"url" is not a valid URL: ${url}`)
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('only http(s) URLs can be fetched')
      }

      const result = await ctx.web.fetch({ url: parsed.href })
      const text = result.text.length <= maxOutputChars
        ? result.text
        : `${result.text.slice(0, maxOutputChars)}\n\n[truncated at ${maxOutputChars} characters]`
      const header = result.title ? `# ${result.title}\n${result.url}\n\n` : `${result.url}\n\n`
      return { content: [{ type: 'text', text: `${header}${text}` }] }
    },
  })
}

function requireString(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`"${key}" must be a non-empty string`)
  }
  return value
}

function optionalPositiveInteger(
  args: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = args[key]
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`"${key}" must be a positive integer`)
  }
  return value
}

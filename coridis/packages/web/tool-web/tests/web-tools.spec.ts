import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemPromptService } from '@coridis/system-prompt'
import { ToolsService } from '@coridis/tools'
import type { ToolExecutionResult } from '@coridis/tools'
import { WebRuntime } from '@coridis/web'
import * as toolWeb from '../src/index.ts'

const search = vi.fn(async () => ({
  sources: [
    { title: 'First', url: 'https://example.com/1', snippet: 'Snippet one.' },
    { title: '', url: 'https://example.com/2', snippet: 'Snippet two.' },
    { title: 'Third', url: 'https://example.com/3' },
  ],
}))
const fetchPage = vi.fn(async (request: { url: string }) => ({
  url: request.url,
  title: 'Fetched',
  text: 'abcdefghijklmnopqrstuvwxyz',
}))

let ctx: Context

beforeEach(async () => {
  search.mockClear()
  fetchPage.mockClear()
  ctx = new Context()
  await ctx.plugin(SystemPromptService)
  await ctx.plugin(ToolsService)
  await ctx.plugin(WebRuntime)
  ctx.web.registerSearchProvider({ id: 'search', search })
  ctx.web.registerFetchProvider({ id: 'fetch', fetch: fetchPage })
  await ctx.plugin(toolWeb, { searchMaxResults: 2, fetchMaxOutputChars: 500 })
})

async function run(name: string, args: Readonly<Record<string, unknown>>): Promise<ToolExecutionResult> {
  const [result] = await ctx.tools.execute([{ name, args }])
  if (result === undefined) throw new Error(`${name} returned no result`)
  return result
}

function text(result: ToolExecutionResult): string {
  const block = result.content[0]
  return block?.type === 'text' ? block.text : ''
}

describe('web tools', () => {
  it('registers both tools and their prompt guidance', async () => {
    expect(ctx.tools.get('web_search')).toBeDefined()
    expect(ctx.tools.get('web_fetch')).toBeDefined()
    const system = (await ctx.systemPrompt.assemble({})).system
    expect(system).toContain('`web_search`')
    expect(system).toContain('`web_fetch`')
  })

  it('renders ranked search sources and caps max_results', async () => {
    const result = await run('web_search', { query: 'cordis', max_results: 99 })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe([
      '1. First',
      '   https://example.com/1',
      '   Snippet one.',
      '',
      '2. (untitled)',
      '   https://example.com/2',
      '   Snippet two.',
      '',
      '3. Third',
      '   https://example.com/3',
    ].join('\n'))
    expect(search).toHaveBeenCalledWith({ query: 'cordis', maxResults: 2 })
  })

  it('reports an empty result set and validates arguments', async () => {
    search.mockResolvedValueOnce({ sources: [] })
    expect(text(await run('web_search', { query: 'nothing' })))
      .toBe('No web results for "nothing".')

    const noQuery = await run('web_search', {})
    expect(noQuery.isError).toBe(true)
    expect(text(noQuery)).toContain('"query" must be a non-empty string')

    const badLimit = await run('web_search', { query: 'q', max_results: 0 })
    expect(badLimit.isError).toBe(true)
    expect(text(badLimit)).toContain('"max_results" must be a positive integer')
  })

  it('fetches pages with a title header and caps the body', async () => {
    fetchPage.mockResolvedValueOnce({
      url: 'https://example.com/page',
      title: 'Fetched',
      text: 'a'.repeat(600),
    })
    const result = await run('web_fetch', { url: 'https://example.com/page' })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe([
      '# Fetched',
      'https://example.com/page',
      '',
      'a'.repeat(500),
      '',
      '[truncated at 500 characters]',
    ].join('\n'))
    expect(fetchPage).toHaveBeenCalledWith({ url: 'https://example.com/page' })
  })

  it('omits the title header when the page has none', async () => {
    fetchPage.mockResolvedValueOnce({ url: 'https://example.com/page', text: 'short' })
    expect(text(await run('web_fetch', { url: 'https://example.com/page' })))
      .toBe('https://example.com/page\n\nshort')
  })

  it('rejects malformed and non-http URLs before fetching', async () => {
    const malformed = await run('web_fetch', { url: 'not a url' })
    expect(malformed.isError).toBe(true)
    expect(text(malformed)).toContain('is not a valid URL')

    const protocol = await run('web_fetch', { url: 'file:///etc/passwd' })
    expect(protocol.isError).toBe(true)
    expect(text(protocol)).toContain('only http(s) URLs can be fetched')
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('can disable either tool', async () => {
    const disabled = new Context()
    await disabled.plugin(SystemPromptService)
    await disabled.plugin(ToolsService)
    await disabled.plugin(WebRuntime)
    await disabled.plugin(toolWeb, { search: false })
    expect(disabled.tools.get('web_search')).toBeUndefined()
    expect(disabled.tools.get('web_fetch')).toBeDefined()
  })
})

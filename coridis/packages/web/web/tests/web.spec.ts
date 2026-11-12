import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { WebError, WebRuntime } from '../src/index.ts'
import type { Config, WebFetchProvider, WebSearchProvider } from '../src/index.ts'

async function mount(config: Config = {}): Promise<WebRuntime> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, config)
  return ctx.web
}

const searchProvider: WebSearchProvider = {
  id: 'fake-search',
  async search(request) {
    return { sources: [{ title: 'Hit', url: `https://example.com/?q=${request.query}` }] }
  },
}

const fetchProvider: WebFetchProvider = {
  id: 'fake-fetch',
  async fetch(request) {
    return { url: request.url, title: 'Page', text: 'Body' }
  },
}

describe('WebRuntime', () => {
  it('registers providers and routes requests to the first one', async () => {
    const web = await mount()
    web.registerSearchProvider(searchProvider)
    web.registerFetchProvider(fetchProvider)

    expect(web.providers()).toEqual({ search: ['fake-search'], fetch: ['fake-fetch'] })
    expect(await web.search({ query: 'cordis' })).toEqual({
      sources: [{ title: 'Hit', url: 'https://example.com/?q=cordis' }],
    })
    expect(await web.fetch({ url: 'https://example.com/page' })).toEqual({
      url: 'https://example.com/page',
      title: 'Page',
      text: 'Body',
    })
  })

  it('selects configured providers when several are registered', async () => {
    const web = await mount({ searchProvider: 'second-search', fetchProvider: 'second-fetch' })
    web.registerSearchProvider(searchProvider)
    web.registerSearchProvider({
      id: 'second-search',
      async search() {
        return { sources: [{ title: 'Second', url: 'https://example.com/second' }] }
      },
    })
    web.registerFetchProvider(fetchProvider)
    web.registerFetchProvider({
      id: 'second-fetch',
      async fetch(request) {
        return { url: request.url, text: 'second body' }
      },
    })

    expect(await web.search({ query: 'q' })).toEqual({
      sources: [{ title: 'Second', url: 'https://example.com/second' }],
    })
    expect((await web.fetch({ url: 'https://example.com' })).text).toBe('second body')
  })

  it('fails loudly for ambiguous or missing configured providers', async () => {
    const ambiguous = await mount()
    ambiguous.registerSearchProvider(searchProvider)
    ambiguous.registerSearchProvider({ ...searchProvider, id: 'other-search' })
    ambiguous.registerFetchProvider(fetchProvider)
    ambiguous.registerFetchProvider({ ...fetchProvider, id: 'other-fetch' })

    await expect(ambiguous.search({ query: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_AMBIGUOUS',
    })
    await expect(ambiguous.fetch({ url: 'https://example.com' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_AMBIGUOUS',
    })

    const missing = await mount({ searchProvider: 'missing', fetchProvider: 'missing' })
    await expect(missing.search({ query: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_CONFIGURED_MISSING',
    })
    await expect(missing.fetch({ url: 'https://example.com' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_CONFIGURED_MISSING',
    })
  })

  it('reports unavailable providers with a stable code', async () => {
    const web = await mount()
    await expect(web.search({ query: 'q' })).rejects.toMatchObject({
      name: 'WebError',
      code: 'WEB_PROVIDER_UNAVAILABLE',
    })
    await expect(web.fetch({ url: 'https://example.com' })).rejects.toMatchObject({
      name: 'WebError',
      code: 'WEB_PROVIDER_UNAVAILABLE',
    })
  })

  it('rejects empty and duplicate provider ids', async () => {
    const web = await mount()
    web.registerSearchProvider(searchProvider)
    expect(() => web.registerSearchProvider(searchProvider)).toThrow(/already registered/)
    expect(() => web.registerSearchProvider({ ...searchProvider, id: '  ' }))
      .toThrow(/id must not be empty/)
    expect(() => web.registerFetchProvider({ ...fetchProvider, id: '' }))
      .toThrow(/id must not be empty/)

    try {
      web.registerFetchProvider(fetchProvider)
      web.registerFetchProvider(fetchProvider)
    } catch (error) {
      expect(error).toBeInstanceOf(WebError)
      expect((error as WebError).code).toBe('WEB_DUPLICATE_PROVIDER')
    }
  })

  it('unregisters providers through their disposers', async () => {
    const web = await mount()
    const dispose = web.registerSearchProvider(searchProvider)
    dispose()
    expect(web.providers().search).toEqual([])
    await expect(web.search({ query: 'q' })).rejects.toThrow(/no web search provider is registered/)
  })
})

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebRuntime } from '@coridis/web'
import * as tavily from '../src/index.ts'

async function mount(): Promise<WebRuntime> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime)
  await ctx.plugin(tavily, { baseURL: 'https://tavily.test/' })
  return ctx.web
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('web-search-tavily provider', () => {
  it('maps the neutral request to Tavily and filters unusable results', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'secret')
    const fetchMock = vi.fn(async () => jsonResponse({
      results: [
        { title: 'One', url: 'https://example.com/1', content: 'First.' },
        { title: 'No URL' },
        { url: 'https://example.com/3' },
        { title: 'No snippet', url: 'https://example.com/4', content: '' },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const web = await mount()

    expect(await web.search({ query: 'cordis agent', maxResults: 3 })).toEqual({
      sources: [
        { title: 'One', url: 'https://example.com/1', snippet: 'First.' },
        { title: 'https://example.com/3', url: 'https://example.com/3' },
        { title: 'No snippet', url: 'https://example.com/4' },
      ],
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://tavily.test/search')
    expect(JSON.parse(String(init.body))).toEqual({
      api_key: 'secret',
      query: 'cordis agent',
      max_results: 3,
      search_depth: 'basic',
    })
  })

  it('defaults to five results', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'secret')
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const web = await mount()

    expect(await web.search({ query: 'q' })).toEqual({ sources: [] })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).max_results).toBe(5)
  })

  it('requires the API key before issuing a request', async () => {
    vi.stubEnv('TAVILY_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const web = await mount()

    await expect(web.search({ query: 'q' }))
      .rejects.toThrow(/Tavily API key is missing: set TAVILY_API_KEY/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports HTTP and JSON failures', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'secret')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 401 })))
    const web = await mount()
    await expect(web.search({ query: 'q' }))
      .rejects.toThrow(/Tavily search failed \(401\): denied/)

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })))
    await expect(web.search({ query: 'q' })).rejects.toThrow(/invalid JSON/)
  })
})

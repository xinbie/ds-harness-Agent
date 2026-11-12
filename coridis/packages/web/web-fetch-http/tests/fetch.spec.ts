import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebRuntime } from '@coridis/web'
import * as webFetch from '../src/index.ts'

async function mount(config: Partial<webFetch.Config> = {}): Promise<WebRuntime> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime)
  await ctx.plugin(webFetch, { timeoutMs: 1000, ...config })
  return ctx.web
}

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('web-fetch-http provider', () => {
  it('converts HTML to readable text and strips non-content elements', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => html(
      '<!doctype html><html><head><title>My &amp; Page</title><style>.x{}</style></head>' +
      '<body><h1>Hello</h1><p>World &amp; friends.</p><ul><li>One</li><li>Two</li></ul>' +
      '<script>bad()</script></body></html>',
    )))
    const web = await mount()

    const result = await web.fetch({ url: 'https://example.com/page' })
    expect(result.title).toBe('My & Page')
    expect(result.text).toBe('Hello\nWorld & friends.\n- One\n- Two')
    expect(result.text).not.toContain('bad()')
    expect(result.text).not.toContain('.x{}')
  })

  it('passes non-HTML bodies through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('plain body', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })))
    const web = await mount()

    expect(await web.fetch({ url: 'https://example.com/file.txt' })).toEqual({
      url: 'https://example.com/file.txt',
      text: 'plain body',
    })
  })

  it('caps oversized output', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('abcdefghijklmnop', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })))
    const web = await mount({ maxOutputChars: 10 })

    expect(await web.fetch({ url: 'https://example.com/long' })).toEqual({
      url: 'https://example.com/long',
      text: 'abcdefghij\n\n[truncated at 10 characters]',
    })
  })

  it('reports HTTP failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', {
      status: 503,
      statusText: 'Service Unavailable',
    })))
    const web = await mount()

    await expect(web.fetch({ url: 'https://example.com/down' }))
      .rejects.toThrow(/web fetch failed \(503 Service Unavailable\)/)
  })

  it('sends a browser-like accept header and user agent', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const web = await mount({ userAgent: 'test-agent' })

    await web.fetch({ url: 'https://example.com' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.redirect).toBe('follow')
    expect((init.headers as Record<string, string>)['user-agent']).toBe('test-agent')
    expect((init.headers as Record<string, string>).accept).toContain('text/html')
  })
})

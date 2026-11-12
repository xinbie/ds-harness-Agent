/**
 * Plain HTTP fetch provider for `ctx.web`. A Service Provider only: it fetches
 * a URL and converts HTML to readable text.
 *
 * @module @coridis/web-fetch-http
 */

import type { Context } from '@deepseek-ai/cordis'
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@coridis/web'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-fetch-http'

/** The seam this provider registers into. */
export const inject = ['web']

/** Provider configuration. */
export interface Config {
  /** Provider id. Defaults to `http`. */
  readonly id?: string
  /** Cooperative per-request timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Cap on returned text characters. */
  readonly maxOutputChars?: number
  /** User-Agent sent with the request. */
  readonly userAgent?: string
}

/** Register the HTTP fetch provider on `ctx.web`. */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = createProvider(config)
  ctx.effect(() => ctx.web.registerFetchProvider(provider), 'web-fetch-http.provide')
}

function createProvider(config: Config): WebFetchProvider {
  const id = config.id ?? 'http'
  const timeoutMs = config.timeoutMs ?? 30_000
  const maxOutputChars = config.maxOutputChars ?? 200_000
  const userAgent = config.userAgent ?? 'coridis/0.0.0'

  return {
    id,
    async fetch(request: WebFetchRequest): Promise<WebFetchResult> {
      const controller = new AbortController()
      const abort = () => controller.abort(request.signal?.reason)
      request.signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(
        () => controller.abort(new Error(`web fetch timed out after ${timeoutMs}ms`)),
        timeoutMs,
      )
      timer.unref?.()

      try {
        const response = await fetch(request.url, {
          headers: {
            accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
            'user-agent': userAgent,
          },
          redirect: 'follow',
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(`web fetch failed (${response.status} ${response.statusText}) for ${request.url}`)
        }
        const contentType = response.headers.get('content-type') ?? ''
        const body = await response.text()
        const finalURL = response.url || request.url
        if (contentType.includes('html') || looksLikeHTML(body)) {
          const page = htmlToText(body)
          return {
            url: finalURL,
            ...(page.title ? { title: page.title } : {}),
            text: cap(page.text, maxOutputChars),
          }
        }
        return { url: finalURL, text: cap(body, maxOutputChars) }
      } finally {
        clearTimeout(timer)
        request.signal?.removeEventListener('abort', abort)
      }
    },
  }
}

function looksLikeHTML(body: string): boolean {
  return /^\s*<!doctype html|<html[\s>]/i.test(body)
}

function htmlToText(html: string): { title?: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = titleMatch?.[1]
    ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() || undefined
    : undefined

  let text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|blockquote|pre|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')

  text = decodeEntities(text)
    .split('\n')
    .map(line => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { ...(title ? { title } : {}), text }
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  }
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x'
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return named[entity.toLowerCase()] ?? match
  })
}

function cap(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n\n[truncated at ${limit} characters]`
}

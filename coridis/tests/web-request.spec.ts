/**
 * Web request helper + integration spec.
 *
 * Input : the URL in `WEB_TEST_URL`.
 * Output: the absolute path of the saved HTML file (printed and returned by
 *         `fetchHtmlToFile`). Files go to `.local/test-output/` by default;
 *         override with `WEB_TEST_OUTPUT_DIR`.
 *
 * Run only this spec:
 *   WEB_TEST_URL=https://example.com npm run test:web
 *
 * Without `WEB_TEST_URL` the test is skipped, so the default suite stays
 * offline and deterministic. The saved path is printed and also written to
 * `latest-path.txt` alongside the HTML file.
 */

import { createHash } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaultOutputDir = join(projectRoot, '.local', 'test-output')

/** Fetch `url` and write the raw HTML body to disk; return the absolute path. */
export async function fetchHtmlToFile(
  url: string,
  outputDir: string = defaultOutputDir,
): Promise<string> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
    headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
  })
  if (!response.ok) {
    throw new Error(`web request failed (${response.status} ${response.statusText}) for ${url}`)
  }

  const body = await response.text()
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('html') && !/^\s*(<!doctype html|<html[\s>])/i.test(body)) {
    throw new Error(`expected an HTML response from ${url}, got "${contentType || 'unknown'}"`)
  }

  await mkdir(outputDir, { recursive: true })
  const file = join(outputDir, fileNameFor(response.url || url))
  await writeFile(file, body, 'utf8')
  return file
}

/** Deterministic, filesystem-safe file name derived from the final URL. */
function fileNameFor(rawURL: string): string {
  const url = new URL(rawURL)
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/index'
  const stem = `${url.hostname}${path}`
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '') || 'page'
  const hash = url.search
    ? `-${createHash('sha1').update(url.search).digest('hex').slice(0, 8)}`
    : ''
  return `${stem}${hash}.html`
}

const inputURL = process.env.WEB_TEST_URL?.trim() ?? ''
const outputDir = process.env.WEB_TEST_OUTPUT_DIR
  ? resolve(projectRoot, process.env.WEB_TEST_OUTPUT_DIR)
  : undefined

describe.skipIf(inputURL === '')('web request: save page HTML', () => {
  it('fetches WEB_TEST_URL and prints the saved HTML path', async () => {
    const file = await fetchHtmlToFile(inputURL, outputDir)
    // Machine-readable companion file, so the path is available even when the
    // reporter hides console output.
    await writeFile(join(dirname(file), 'latest-path.txt'), `${file}\n`, 'utf8')
    console.log(`\n[web-request] HTML saved to: ${file}\n`)

    expect(file.endsWith('.html')).toBe(true)
    expect((await stat(file)).size).toBeGreaterThan(0)
  }, 35_000)
})

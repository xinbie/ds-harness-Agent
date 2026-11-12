// 实时演示：用 coridis 的 web-fetch-http 能力抓取网页并转成文本。
// 用法：node demo-fetch.mjs [url]
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime } from '@coridis/web'
import * as webFetchHttp from '@coridis/web-fetch-http'

const url = process.argv[2] ?? 'https://example.com'

const ctx = new Context()
await ctx.plugin(WebRuntime)
await ctx.plugin(webFetchHttp, { timeoutMs: 30_000, maxOutputChars: 500 })

console.log(`→ 正在抓取 ${url} ...\n`)

const result = await ctx.web.fetch({ url })

console.log('── 标题 ────────────────────────────')
console.log(result.title ?? '(无标题)')
console.log('── 最终 URL ─────────────────────────')
console.log(result.url)
console.log('── 转文本后的正文（前 500 字符）──')
console.log(result.text)

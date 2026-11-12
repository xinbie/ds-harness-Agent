# 案例：高并发、持续运行的网页爬取 Agent

本教程从一次抓取开始，逐步组装出一个能并发抓取、并能定时持续巡检的 coridis Agent。
所有示例只使用仓库现有包，不新增依赖。

适用场景：盯住一组公开页面，周期性抓取并交给模型归纳新增信息。
不涉及登录、JavaScript 渲染、验证码或反爬绕过；请遵守目标站点的 robots.txt 与服务条款。

## 运行环境

```sh
npm install
npm run build
export DEEPSEEK_API_KEY=...
```

示例使用 TypeScript，通过仓库自带的 Node 与 tsx 运行：

```sh
./.local/node/bin/node --import tsx crawl-agent.ts
```

## 1. 最小闭环：抓取一个页面

`ctx.web` 是 Web 能力的 Service Definition，具体由 provider 实现。这里挂载 HTTP provider，
它负责超时、重定向和 HTML 转纯文本；调用方只看到 `WebFetchResult`。

```ts
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime } from '@coridis/web'
import * as webFetchHttp from '@coridis/web-fetch-http'

const ctx = new Context()
await ctx.plugin(WebRuntime)
await ctx.plugin(webFetchHttp, { timeoutMs: 20_000, maxOutputChars: 50_000 })

const page = await ctx.web.fetch({ url: 'https://example.com' })
console.log(page.title)
console.log(page.text.slice(0, 200))
```

`ctx.plugin()` 返回时插件已挂载；`ctx.effect()` 中注册的资源会在插件卸载时回收。
换成别的抓取实现时，只替换 provider，调用方不变。

## 2. 有界并发：不要对整批 URL 使用 `Promise.all`

一次抓取几十个页面时，`Promise.all(urls.map(fetch))` 会同时打开所有连接，容易被限流，
也可能耗尽文件描述符。用固定数量的 worker 消费队列，就能把并发压在上限内。

```ts
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++
      const item = items[index]
      if (item === undefined) return
      results[index] = await task(item)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
```

`mapLimit` 保持输入顺序；`limit` 只限制当前进程的并发，不限制单个站点的请求频率。

## 3. 把批量抓取注册成模型可用的工具

模型只能调用注册在 `ctx.tools` 上的工具。下面的插件把“并发抓取一批 URL”包装成 `crawl`：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@coridis/tools'
import type {} from '@coridis/web'

export const name = 'crawl-tool'
export const inject = ['tools', 'web']

export interface Config {
  readonly concurrency?: number
  readonly maxUrls?: number
  readonly maxCharsPerPage?: number
}

export function apply(ctx: Context, config: Config = {}): void {
  const concurrency = Math.max(1, Math.floor(config.concurrency ?? 8))
  const maxUrls = Math.max(1, Math.floor(config.maxUrls ?? 50))
  const maxChars = Math.max(500, Math.floor(config.maxCharsPerPage ?? 8_000))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'crawl',
    description: 'Concurrently fetch many URLs and return readable text. '
      + 'Use it for broad coverage before summarizing.',
    parameters: {
      type: 'object',
      properties: {
        urls: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: maxUrls },
        max_chars_per_page: { type: 'integer', minimum: 500 },
      },
      required: ['urls'],
      additionalProperties: false,
    },
    async execute(args, execution) {
      const raw = args.urls
      if (!Array.isArray(raw) || raw.length === 0 || raw.some(url => typeof url !== 'string')) {
        throw new Error('"urls" must be a non-empty array of strings')
      }
      const urls = [...new Set(raw as string[])].slice(0, maxUrls)
      const requested = args.max_chars_per_page
      const perPage = typeof requested === 'number' && Number.isFinite(requested)
        ? Math.min(maxChars, Math.max(500, Math.floor(requested)))
        : maxChars

      const pages = await mapLimit(urls, concurrency, async url => {
        try {
          const page = await ctx.web.fetch({
            url,
            ...(execution.signal === undefined ? {} : { signal: execution.signal }),
          })
          return `## ${page.title ?? url}\n${page.url}\n\n${page.text.slice(0, perPage)}`
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return `## ${url}\n\n[fetch failed] ${message}`
        }
      })

      return { content: [{ type: 'text', text: pages.join('\n\n---\n\n') }] }
    },
  })))
}
```

几个关键点：

- `inject = ['tools', 'web']` 让 Cordis 等到两个服务就绪后再挂载，不需要手动排序。
- `ctx.effect()` 包住 `register()`，插件卸载时工具自动消失。
- `execution.signal` 来自当前 turn；abort 时抓取一并取消。
- 单个 URL 失败只返回一段错误文本，不会让整批工具调用失败。
- 每页截断到 `max_chars_per_page`，避免一次工具结果撑爆模型上下文。

把第 2 节的 `mapLimit` 放进同一个文件即可。

## 4. 组装 Agent：执行一次爬取任务

Agent 循环需要会话、模型、提示词、工具和 Agent 注册表。按依赖顺序挂载即可：

```ts
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@coridis/agent'
import * as agentLoop from '@coridis/agent-loop'
import { LlmService } from '@coridis/llm'
import * as deepseek from '@coridis/llm-deepseek'
import { SessionStore } from '@coridis/session'
import { SystemPromptService } from '@coridis/system-prompt'
import { ToolsService } from '@coridis/tools'
import { WebRuntime } from '@coridis/web'
import * as webFetchHttp from '@coridis/web-fetch-http'
import * as crawlTool from './crawl-tool.ts'

const ctx = new Context()
await ctx.plugin(SessionStore)
await ctx.plugin(LlmService)
await ctx.plugin(deepseek, { model: 'deepseek-chat', apiKeyEnv: 'DEEPSEEK_API_KEY' })
await ctx.plugin(SystemPromptService, {
  personaPrefix: 'You are a research agent. Cite the URL for every claim.',
})
await ctx.plugin(ToolsService)
await ctx.plugin(WebRuntime)
await ctx.plugin(webFetchHttp, { timeoutMs: 20_000, maxOutputChars: 50_000 })
await ctx.plugin(crawlTool, { concurrency: 8, maxUrls: 50, maxCharsPerPage: 8_000 })
await ctx.plugin(AgentRegistry)
await ctx.plugin(agentLoop, {
  model: 'deepseek-chat',
  maxSteps: 24,
  maxParallelToolCalls: 8,
})

const handle = await ctx.agents.create()

let answer = ''
ctx.on('session/event', (session, event) => {
  if (session.id === handle.agent.sessionId && event.type === 'assistant/message') {
    answer = event.data.text
  }
})

handle.agent.followup(
  '用 crawl 抓取这些页面，归纳新增信息，并给出来源 URL：\n'
  + 'https://example.com/a\nhttps://example.com/b',
)
await handle.agent.whenIdle()

if (handle.agent.lastError !== undefined) {
  console.error(handle.agent.lastError)
}
console.log(answer)
await handle.dispose()
```

`followup()` 只把消息放进收件箱并唤醒驱动；`whenIdle()` 等这一轮全部结束。
一个 turn 内，模型可以连续多步调用 `crawl`，直到不再发起工具调用或达到 `maxSteps`。
每一步里，最多 `maxParallelToolCalls` 个工具调用会并行执行。

## 5. 持续巡检：定时把新任务送进同一个 Agent

Agent 的一轮任务会结束，持续运行需要外部再次投递消息。下面的插件复用同一个 Agent，
每轮结束、等待间隔、再投递下一次巡检：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@coridis/agent'

export const name = 'crawl-watch'
export const inject = ['agents']

export interface Config {
  readonly urls: readonly string[]
  readonly intervalMs?: number
  readonly prompt?: string
}

export function apply(ctx: Context, config: Config): void {
  const intervalMs = Math.max(10_000, config.intervalMs ?? 300_000)
  const stop = new AbortController()

  ctx.effect(() => {
    void watch().catch(error => console.error('crawl-watch failed:', error))
    return () => stop.abort()
  })

  async function watch(): Promise<void> {
    const handle = await ctx.agents.create()
    try {
      let round = 0
      while (!stop.signal.aborted) {
        round += 1
        handle.agent.followup(
          config.prompt
            ?? `第 ${round} 轮巡检。用 crawl 抓取以下页面，只报告新增或有变化的内容：\n`
              + config.urls.join('\n'),
        )
        await handle.agent.whenIdle()
        if (handle.agent.lastError !== undefined) {
          console.error(`round ${round}:`, handle.agent.lastError.message)
        }
        await sleep(intervalMs, stop.signal)
      }
    } finally {
      await handle.dispose()
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}
```

持续模式不需要第 4 节的一次性 `handle`。保留相同的服务挂载，把“创建 Agent 并投递一次任务”
的部分替换为：

```ts
import * as crawlWatch from './crawl-watch.ts'

await ctx.plugin(crawlWatch, {
  urls: ['https://example.com/news'],
  intervalMs: 300_000,
})
```

该插件必须在 `agent-loop` 之后挂载，否则 `ctx.agents.create()` 找不到工厂。
`whenIdle()` 是天然的反压：上一轮没结束就不会投递下一轮。`ctx.effect` 的 disposer
会中止等待并释放 Agent，避免插件卸载后残留定时任务。

“新增”目前依赖模型对上下文的判断。需要更严格时，在插件里记录已见 URL 和内容哈希，
只把新 URL 投递给 Agent；这部分状态属于业务逻辑，不必放进 Agent 循环。

## 6. 并发与参数

抓取峰值由三层相乘决定：

```text
峰值并发 ≈ Agent 数 × maxParallelToolCalls × crawl 的 concurrency
```

例如一个 Agent、`maxParallelToolCalls: 8`、`concurrency: 8`，理论上同时最多 64 个请求。
实际使用建议把乘积控制在 16–32 以内，并对同一站点进一步降速。

| 参数 | 位置 | 作用 |
|---|---|---|
| `timeoutMs` | `web-fetch-http` | 单次抓取超时 |
| `concurrency` | `crawl-tool` | 单次 `crawl` 内部的并发 |
| `maxUrls` | `crawl-tool` | 单次调用最多抓取多少 URL |
| `maxCharsPerPage` | `crawl-tool` | 单页进入模型上下文的字符上限 |
| `maxParallelToolCalls` | `agent-loop` | 单步内并行执行的工具调用数 |
| `maxSteps` | `agent-loop` | 单个 turn 的最大步数 |
| `intervalMs` | `crawl-watch` | 巡检间隔，也是最低限度的站点礼貌 |

上下文预算也要算总账：`maxUrls × maxCharsPerPage` 才是单次工具结果的上限。
若需要抓取很多页面，先降采样或在工具内做摘要，不要把全部正文直接交给模型。

## 7. 失败处理与长期运行

- 抓取失败已在工具内隔离；本轮整体失败时查看 `agent.lastError`。
- `agent.dispose()` 会中断 in-flight 请求并等待驱动退出；上下文释放时务必调用。
- 当前会话日志在内存中，没有持久化与压缩。进程运行越久，日志越大；长期部署应增加
  持久化和压缩插件，而不是在循环里手动截断。
- 对 429、5xx 建议实现指数退避重试，但不要把重试放大成全站压力。
- 只抓取公开、允许抓取的内容；控制频率，设置可识别的 User-Agent。

## 8. 小结

这个案例没有改动 Agent 循环，也没有新增中心模块：

- `ctx.web` 提供可替换的抓取能力；
- `crawl` 工具把并发策略暴露给模型；
- `agent-loop` 负责 turn/step 与工具调用；
- 调度插件只负责“持续投递”，卸载时完全回收。

需要搜索发现新 URL 时，再挂载 `@coridis/tool-web`；需要更多抓取并发时，先调参数，
再考虑共享限流器，而不是在每个工具里各开一个池。

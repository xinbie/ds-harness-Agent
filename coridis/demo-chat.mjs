// 交互式多轮对话：在同一个进程/同一个会话里连续提问。
// 适合“先抓取一个页面，再告诉 agent 我选第几种方式”的场景。
//
// 用法：
//   cd /root/agent-software/coridis
//   . ./.local/activate.sh
//   export DEEPSEEK_API_KEY=sk-你的key
//   node demo-chat.mjs
//
// 退出：输入 /exit 或 /quit。
// 没有 Key 时可先离线验证交互：
//   CORIDIS_FAKE=1 node demo-chat.mjs
import { Context } from '@deepseek-ai/cordis'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { AgentRegistry } from '@coridis/agent'
import * as agentLoop from '@coridis/agent-loop'
import { LlmService } from '@coridis/llm'
import * as deepseek from '@coridis/llm-deepseek'
import { SessionStore } from '@coridis/session'
import { SystemPromptService } from '@coridis/system-prompt'
import { ToolsService } from '@coridis/tools'
import { WebRuntime } from '@coridis/web'
import * as webFetchHttp from '@coridis/web-fetch-http'
import * as toolWeb from '@coridis/tool-web'

const fake = process.env.CORIDIS_FAKE === '1'
const model = fake ? 'fake-model' : (process.env.CORIDIS_MODEL ?? 'deepseek-chat')

const ctx = new Context()
await ctx.plugin(SessionStore)
await ctx.plugin(LlmService)
await ctx.plugin(SystemPromptService)
await ctx.plugin(ToolsService)
await ctx.plugin(AgentRegistry)

// 网页抓取能力：web_fetch（不需要 Key）
await ctx.plugin(WebRuntime)
await ctx.plugin(webFetchHttp, { timeoutMs: 30_000, maxOutputChars: 200_000 })
await ctx.plugin(toolWeb, { search: false, fetch: true })

// 模型：真实 DeepSeek，或离线脚本化模型
if (fake) {
  ctx.llm.registerAdapter({
    id: 'fake',
    models: ['fake-model'],
    async *stream(request) {
      const last = [...request.messages].reverse().find(message => message.role === 'user')
      const text = typeof last?.content === 'string' ? last.content : ''
      yield { type: 'text-delta', text: `(fake) 收到: ${text}` }
      yield { type: 'finish', reason: 'stop' }
    },
  })
} else {
  await ctx.plugin(deepseek, { model, apiKeyEnv: 'DEEPSEEK_API_KEY' })
}

await ctx.plugin(agentLoop, { model, maxSteps: 24 })

const handle = await ctx.agents.create({})
const rl = createInterface({ input, output })

console.log('coridis chat — 同一会话内多轮对话；输入 /exit 退出。')
console.log(`会话 ID: ${handle.agent.sessionId}`)

try {
  rl.setPrompt('你> ')
  rl.prompt()
  for await (const line of rl) {
    const task = line.trim()
    if (task === '') {
      rl.prompt()
      continue
    }
    if (task === '/exit' || task === '/quit') break

    const session = ctx.sessions.get(handle.agent.sessionId)
    const start = session?.events.length ?? 0

    handle.agent.followup(task)
    await handle.agent.whenIdle()

    const events = ctx.sessions.get(handle.agent.sessionId)?.events.slice(start) ?? []
    const reply = [...events]
      .reverse()
      .find(event => event.type === 'assistant/message' && event.data.text.trim() !== '')
    if (reply) console.log(`\ncoridis> ${reply.data.text}\n`)
    if (handle.agent.lastError) console.log(`\n[error] ${handle.agent.lastError.message}\n`)
    rl.prompt()
  }
} finally {
  rl.close()
  await handle.dispose()
}

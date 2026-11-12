/**
 * Minimal end-to-end case over `@deepseek-ai/cordis`: one Agent turn whose model
 * request asks for `web_search`, then answers from the returned sources.
 *
 * The model adapter and search provider are fakes, so the case is offline and
 * deterministic; only the composition and wiring under test are real.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { AgentRegistry } from '@coridis/agent'
import * as agentLoop from '@coridis/agent-loop'
import { LlmService } from '@coridis/llm'
import type { LlmAdapter, StreamRequest } from '@coridis/llm'
import { SessionStore } from '@coridis/session'
import { SystemPromptService } from '@coridis/system-prompt'
import { ToolsService } from '@coridis/tools'
import { WebRuntime } from '@coridis/web'
import type { WebSearchRequest, WebSearchResult } from '@coridis/web'
import * as toolWeb from '@coridis/tool-web'

describe('cordis minimal case', () => {
  it('runs a model turn that searches the web and answers from the result', async () => {
    const requests: StreamRequest[] = []
    const model: LlmAdapter = {
      id: 'fake',
      models: ['fake-model'],
      async *stream(request) {
        requests.push(request)
        if (requests.length === 1) {
          yield {
            type: 'tool-call',
            call: {
              type: 'tool-call',
              id: 'call-1',
              name: 'web_search',
              arguments: JSON.stringify({ query: 'cordis plugin docs' }),
            },
          }
          yield { type: 'finish', reason: 'tool-calls' }
          return
        }
        yield { type: 'text-delta', text: 'See the Cordis docs.' }
        yield { type: 'finish', reason: 'stop' }
      },
    }

    const search = async (request: WebSearchRequest): Promise<WebSearchResult> => ({
      sources: [{
        title: 'Cordis documentation',
        url: 'https://cordis.example/docs',
        snippet: `result for ${request.query}`,
      }],
    })

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmService)
    await ctx.plugin(SystemPromptService)
    await ctx.plugin(ToolsService)
    await ctx.plugin(WebRuntime)
    ctx.web.registerSearchProvider({ id: 'search', search })
    await ctx.plugin(toolWeb, { search: true, fetch: false })
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(agentLoop, { model: 'fake-model', maxSteps: 4 })
    ctx.llm.registerAdapter(model)

    const handle = await ctx.agents.create()
    try {
      handle.agent.followup('Find the Cordis plugin docs.')
      await handle.agent.whenIdle()
    } finally {
      await handle.dispose()
    }

    expect(handle.agent.lastError).toBeUndefined()
    expect(requests).toHaveLength(2)
    expect(requests[0]?.tools?.map(tool => tool.name)).toContain('web_search')

    const toolMessage = requests[1]?.messages.find(message => message.role === 'tool')
    const toolBlock = Array.isArray(toolMessage?.content) ? toolMessage.content[0] : undefined
    const toolText = toolBlock?.type === 'tool-result' ? toolBlock.content : ''
    expect(toolText).toContain('https://cordis.example/docs')
    expect(toolText).toContain('result for cordis plugin docs')

    const session = ctx.sessions.get(handle.agent.sessionId)
    const assistant = session?.events
      .filter(event => event.type === 'assistant/message')
      .at(-1)
    if (assistant?.type !== 'assistant/message') throw new Error('missing assistant message')
    expect(assistant.data.text).toBe('See the Cordis docs.')
  })
})

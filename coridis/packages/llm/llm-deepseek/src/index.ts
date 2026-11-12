/**
 * DeepSeek model adapter: a Service Provider for the `ctx.llm` seam. It owns
 * wire-format translation only; retries, compaction, and session logging are
 * other plugins' concerns.
 *
 * @module @coridis/llm-deepseek
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  ContentBlock,
  LlmAdapter,
  Message,
  StreamChunk,
  StreamRequest,
  ToolCallBlock,
} from '@coridis/llm'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'llm-deepseek'

/** The model seam this provider registers into. */
export const inject = ['llm']

/** Provider configuration. */
export interface Config {
  /** Adapter id. Defaults to `deepseek`. */
  readonly id?: string
  /** Default model id. Defaults to `deepseek-chat`. */
  readonly model?: string
  /** Base URL of the OpenAI-compatible endpoint. */
  readonly baseURL?: string
  /** Environment variable that holds the API key. Defaults to `DEEPSEEK_API_KEY`. */
  readonly apiKeyEnv?: string
  /** Request timeout in milliseconds. Defaults to 120000. */
  readonly timeoutMs?: number
}

interface WireToolCall {
  readonly id: string
  readonly type?: string
  readonly function: { readonly name: string; readonly arguments: string }
}

interface WireMessage {
  readonly role: string
  readonly content: string | null
  readonly tool_calls?: readonly WireToolCall[]
  readonly tool_call_id?: string
}

interface WireResponse {
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: string | null
      readonly tool_calls?: readonly WireToolCall[]
    }
    readonly finish_reason?: string | null
  }[]
  readonly error?: { readonly message?: string }
}

/** Register a DeepSeek chat-completions adapter on `ctx.llm`. */
export function apply(ctx: Context, config: Config = {}): void {
  const adapter = createAdapter(config)
  ctx.effect(() => ctx.llm.registerAdapter(adapter), 'llm-deepseek.provide')
}

function createAdapter(config: Config): LlmAdapter {
  const id = config.id ?? 'deepseek'
  const model = config.model ?? 'deepseek-chat'
  const baseURL = (config.baseURL ?? 'https://api.deepseek.com').replace(/\/+$/, '')
  const apiKeyEnv = config.apiKeyEnv ?? 'DEEPSEEK_API_KEY'
  const timeoutMs = config.timeoutMs ?? 120_000

  return {
    id,
    models: [model],
    stream(request) {
      return streamCompletion({
        request,
        baseURL,
        apiKeyEnv,
        timeoutMs,
      })
    },
  }
}

interface StreamOptions {
  readonly request: StreamRequest
  readonly baseURL: string
  readonly apiKeyEnv: string
  readonly timeoutMs: number
}

async function* streamCompletion(options: StreamOptions): AsyncGenerator<StreamChunk> {
  const apiKey = process.env[options.apiKeyEnv]
  if (!apiKey) {
    throw new Error(
      `DeepSeek API key is missing: set ${options.apiKeyEnv} before running coridis`,
    )
  }

  const controller = new AbortController()
  const abort = () => controller.abort(options.request.signal?.reason)
  options.request.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(
    () => controller.abort(new Error('DeepSeek request timed out')),
    options.timeoutMs,
  )
  timer.unref?.()

  try {
    const body = {
      model: options.request.model,
      messages: toWireMessages(options.request.messages),
      ...(options.request.tools?.length
        ? {
            tools: options.request.tools.map(tool => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
          }
        : {}),
      stream: false,
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    }

    const response = await fetch(`${options.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const text = await response.text()
    if (!response.ok) {
      throw new Error(`DeepSeek request failed (${response.status}): ${truncate(text)}`)
    }

    let data: WireResponse
    try {
      data = JSON.parse(text) as WireResponse
    } catch {
      throw new Error(`DeepSeek returned invalid JSON: ${truncate(text)}`)
    }
    if (data.error) {
      throw new Error(`DeepSeek error: ${data.error.message ?? truncate(text)}`)
    }

    const choice = data.choices?.[0]
    if (choice === undefined) {
      throw new Error('DeepSeek returned no choices')
    }

    const message = choice.message
    if (typeof message?.content === 'string' && message.content !== '') {
      yield { type: 'text-delta', text: message.content }
    }

    const calls: ToolCallBlock[] = (message?.tool_calls ?? []).map(call => ({
      type: 'tool-call',
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments || '{}',
    }))
    for (const call of calls) {
      yield { type: 'tool-call', call }
    }

    yield {
      type: 'finish',
      reason: calls.length > 0 ? 'tool-calls' : mapFinishReason(choice.finish_reason),
    }
  } finally {
    clearTimeout(timer)
    options.request.signal?.removeEventListener('abort', abort)
  }
}

function toWireMessages(messages: readonly Message[]): WireMessage[] {
  const result: WireMessage[] = []
  for (const message of messages) {
    if (typeof message.content === 'string') {
      result.push({ role: message.role, content: message.content })
      continue
    }

    const blocks: readonly ContentBlock[] = message.content
    if (message.role === 'tool') {
      for (const block of blocks) {
        if (block.type !== 'tool-result') continue
        result.push({
          role: 'tool',
          tool_call_id: block.toolCallId,
          content: block.isError ? `Error: ${block.content}` : block.content,
        })
      }
      continue
    }

    const text = blocks
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    if (message.role === 'assistant') {
      const toolCalls = blocks
        .filter(block => block.type === 'tool-call')
        .map(block => ({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: block.arguments },
        }))
      result.push({
        role: 'assistant',
        content: text === '' ? null : text,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
    } else {
      result.push({ role: message.role, content: text })
    }
  }
  return result
}

function mapFinishReason(reason: string | null | undefined): 'stop' | 'length' {
  return reason === 'length' ? 'length' : 'stop'
}

function truncate(text: string, limit = 500): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

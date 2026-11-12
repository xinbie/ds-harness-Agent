# Tool 调用：一轮最小闭环

一个最小的工具使用场景：模型先要求调用 `read_file`，应用执行工具并把结果回填，模型再给出最终回答。

这里用假适配器模拟模型，不需要 API key；把适配器换成 [DeepSeek Provider](deepseek.md) 就能接真实模型。真实应用通常由 [agent-loop](../../packages/core/agent-loop/README.md) 自动完成这个循环，本示例把协议展开给你看。

## 最简示例

```ts
import { Context } from '@deepseek-ai/cordis'
import LlmService, { assembleStream } from '@coridis/llm'
import type { LlmAdapter, Message, ToolCallBlock, ToolSchema } from '@coridis/llm'

const files: Record<string, string> = { 'hello.txt': 'hello world' }

const readFileSchema: ToolSchema = {
  name: 'read_file',
  description: '按路径读取文本文件。',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
}

function execute(call: ToolCallBlock): string {
  if (call.name !== 'read_file') throw new Error(`未知工具：${call.name}`)
  const { path } = JSON.parse(call.arguments) as { path?: string }
  return path === undefined ? '' : (files[path] ?? '')
}

// 第一次请求要求调用工具；看到 tool-result 后给出最终回答。
const adapter: LlmAdapter = {
  id: 'fake-tools',
  models: ['fake-tools'],
  async *stream(request) {
    const hasToolResult = request.messages.some((message) =>
      Array.isArray(message.content)
      && message.content.some((block) => block.type === 'tool-result'),
    )
    if (!hasToolResult) {
      yield {
        type: 'tool-call',
        call: {
          type: 'tool-call',
          id: 'call-1',
          name: 'read_file',
          arguments: '{"path":"hello.txt"}',
        },
      }
      yield { type: 'finish', reason: 'tool-calls' }
      return
    }
    yield { type: 'text-delta', text: '文件内容是：hello world' }
    yield { type: 'finish', reason: 'stop' }
  },
}

const ctx = new Context()
await ctx.plugin(LlmService)
const dispose = ctx.llm.registerAdapter(adapter)

async function ask(prompt: string): Promise<string> {
  const messages: Message[] = [{ role: 'user', content: prompt }]

  for (let step = 0; step < 4; step += 1) {
    const result = await assembleStream(ctx.llm.stream({
      model: 'fake-tools',
      messages,
      tools: [readFileSchema],
    }))

    if (result.toolCalls.length === 0) return result.text

    // 1. 记录 assistant 的工具调用
    messages.push({ role: 'assistant', content: result.toolCalls })

    // 2. 执行工具并记录 tool-result
    messages.push({
      role: 'tool',
      content: result.toolCalls.map((call) => ({
        type: 'tool-result' as const,
        toolCallId: call.id,
        content: execute(call),
      })),
    })
  }

  throw new Error('工具循环超过最大步数')
}

console.log(await ask('读取 hello.txt')) // 文件内容是：hello world

dispose()
```

## 执行过程

1. 首次请求带上 `tools: [readFileSchema]`，消息只有用户问题。
2. 适配器产出 `tool-call` 和 `finish: 'tool-calls'`；`assembleStream()` 把它们收成 `result.toolCalls`。
3. 应用执行工具，把 assistant 的 `tool-call` 消息和 `tool` 角色的 `tool-result` 消息追加到历史。
4. 第二次请求带上工具结果；适配器产出文本和 `finish: 'stop'`，循环返回最终文本。

## 要点

- 工具调用是**两段式**：模型先请求，应用执行，再把结果作为新消息发回去。
- `tool-result.toolCallId` 必须对应 `tool-call.id`，否则模型无法把结果和调用关联起来。
- 一定要有步数上限；模型可能连续请求工具，循环不能无限跑。
- `tools` 的 `parameters` 是 JSON Schema；`arguments` 是模型返回的原始 JSON 字符串，执行前应自行解析和校验。
- 真实场景建议用 `@coridis/tools` 注册工具、用 `agent-loop` 驱动循环；这里只保留 LLM 接缝上的最小协议。

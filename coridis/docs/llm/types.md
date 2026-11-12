# types

供应商中立的词汇：消息、内容块、工具声明、请求和流块。

**模块**：`packages/llm/llm/src/types.ts` ｜ **入口**：`@coridis/llm`

## 使用场景

在调用 `ctx.llm.stream()` 之前构造请求，或在适配器、测试里描述模型输出。这个模块只定义形状，不做运行时校验。

## 最简示例

```ts
import type { Message, StreamRequest } from '@coridis/llm'

const messages: Message[] = [
  { role: 'user', content: '读取 a.txt' },
  {
    role: 'assistant',
    content: [
      { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"a.txt"}' },
    ],
  },
  {
    role: 'tool',
    content: [
      { type: 'tool-result', toolCallId: 'call-1', content: 'hello' },
    ],
  },
]

const request: StreamRequest = {
  model: 'deepseek-chat',
  messages,
  tools: [
    {
      name: 'read',
      description: '读取文件',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    },
  ],
}
```

## 要点

- `ToolCallBlock.arguments` 和 `ToolSchema.parameters` 保留原始 JSON 形状，类型层不解析。
- `StreamChunk` 只有 `text-delta`、`tool-call`、`finish` 三种。
- `StreamRequest` 只有 `model`、`messages` 是必填；`tools`、`signal` 可选。没有调用选项、重试或请求归属字段。
- 新增词汇时，同步更新 `types.ts`、两份包的 README 和 `DEPENDENCIES.md`。

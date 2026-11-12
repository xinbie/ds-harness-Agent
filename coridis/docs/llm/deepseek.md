# DeepSeek Provider（`llm-deepseek`）

DeepSeek 的 `ctx.llm` 适配器，负责中性词汇与 OpenAI 兼容 `/chat/completions` 之间的转换。

**模块**：`packages/llm/llm-deepseek/src/index.ts` ｜ **入口**：`@coridis/llm-deepseek`

## 使用场景

需要调用 DeepSeek 的 OpenAI 兼容端点，并希望继续使用 `ctx.llm` 的中性消息、工具和流块。

## 最简示例

```ts
// 运行前：export DEEPSEEK_API_KEY=...
import { Context } from '@deepseek-ai/cordis'
import LlmService from '@coridis/llm'
import * as deepseek from '@coridis/llm-deepseek'

const ctx = new Context()
await ctx.plugin(LlmService)
await ctx.plugin(deepseek, { model: 'deepseek-chat' })

for await (const chunk of ctx.llm.stream({
  model: 'deepseek-chat',
  messages: [{ role: 'user', content: '你好' }],
})) {
  if (chunk.type === 'text-delta') process.stdout.write(chunk.text)
}
```

## 要点

- API key 在每次请求时从 `apiKeyEnv` 读取，默认是 `DEEPSEEK_API_KEY`。
- 只映射消息和工具；`maxTokens`、`temperature`、`stop`、归属头都不在契约中。
- 传输固定 `stream: false`：完整响应到达后才产出文本块。
- 适配器不重试；失败以普通 `Error` 抛出，由消费者处理。
- 一个实例只服务一个模型；多模型需要多个实例且模型集合不重叠。

# LlmService（`src/index.ts`）

`ctx.llm` 服务入口：挂载、注册适配器、发起请求。

**模块**：`packages/llm/llm/src/index.ts` ｜ **入口**：`@coridis/llm`（默认导出）

## 使用场景

应用启动时挂载 Definition，再由 Provider 注册适配器；消费者通过 `ctx.llm.stream()` 调用模型。选择、瀑布流派发和可逆注册都在这里完成。

## 最简示例

```ts
import { Context } from '@deepseek-ai/cordis'
import LlmService from '@coridis/llm'

const ctx = new Context()
await ctx.plugin(LlmService)

const dispose = ctx.llm.registerAdapter({
  id: 'echo',
  models: ['echo-1'],
  async *stream() {
    yield { type: 'text-delta', text: 'hello' }
    yield { type: 'finish', reason: 'stop' }
  },
})

for await (const chunk of ctx.llm.stream({
  model: 'echo-1',
  messages: [{ role: 'user', content: 'hi' }],
})) {
  if (chunk.type === 'text-delta') process.stdout.write(chunk.text)
}

dispose()
```

## 要点

- 选择按模型精确匹配；没有适配器时同步抛普通 `Error`，消息会列出已注册的适配器 id。
- 请求原样传给适配器，不归一化消息、工具或选项。
- 适配器错误原样传播，不包装成稳定错误码。
- `listAdapters()`、`models()` 用于诊断。
- 注册通过 `ctx.effect` 完成，插件卸载时自动注销；重复 id 或模型重叠会拒绝注册。

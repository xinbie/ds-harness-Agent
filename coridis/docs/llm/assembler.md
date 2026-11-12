# assembler

把异步流消费成完整记录。

**模块**：`packages/llm/llm/src/assembler.ts` ｜ **入口**：`@coridis/llm`

## 使用场景

调用方不关心增量，只想要最终文本、工具调用和终止原因。例如 CLI 的一问一答、测试断言，或需要先拿到完整结果再做后续处理的步骤。

## 最简示例

```ts
import { assembleStream } from '@coridis/llm'

const result = await assembleStream(ctx.llm.stream({
  model: 'deepseek-chat',
  messages: [{ role: 'user', content: '你好' }],
}))

console.log(result.text)
console.log(result.toolCalls)
console.log(result.reason)
```

## 要点

- `assembleChunks()` 拼接文本、收集工具调用，并读取最后一个 `finish` 的原因。
- `chunks` 保留原始块顺序，不合并相邻文本，也不校验块形状。
- 流结束时没有 `finish` 会抛普通 `Error`。
- 需要边到达边处理时直接用 `for await`，不要经过装配器。

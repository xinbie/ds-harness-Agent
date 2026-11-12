# llm 模块指南

`@coridis/llm` 的每个源模块一篇文档，每篇只给一个最小示例，说明这个模块解决什么问题、什么时候用。

## 最小起步

```ts
import { Context } from '@deepseek-ai/cordis'
import LlmService from '@coridis/llm'

const ctx = new Context()
await ctx.plugin(LlmService)
ctx.llm.registerAdapter({
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
```

## 从哪开始

| 文档 | 模块 | 适用场景 |
|---|---|---|
| [service.md](service.md) | `src/index.ts` | 挂载 `ctx.llm`、注册适配器、发起模型请求 |
| [types.md](types.md) | `src/types.ts` | 构造消息、工具声明、请求和流块 |
| [assembler.md](assembler.md) | `src/assembler.ts` | 一次性拿到最终文本、工具调用和终止原因 |
| [deepseek.md](deepseek.md) | `llm-deepseek/src/index.ts` | 挂载 DeepSeek Provider 并调用 |

## 示例约定

为了保持示例最短，部分片段沿用以下上下文：

- `ctx` 是已经挂载了 `LlmService` 的 Cordis `Context`；
- `request` 是一个合法的 `StreamRequest`；
- `handle`、`consume`、`doWork` 是占位的业务函数，不是本包 API。

每个示例只演示该模块的一个核心用法；完整行为以[包 README](../../packages/llm/llm/README.md) 为准。

## 场景示例

- [tool-use.md](tool-use.md) —— 从模型请求工具、执行工具到回填结果的最小闭环。

## 公开入口

公开入口 `@coridis/llm` 导出：

- `LlmService`（默认导出）、`ctx.llm` 与 `llm/stream` 的类型声明；
- 全部词汇类型（`Message`、`StreamRequest`、`LlmAdapter` 等）；
- `assembleStream`、`assembleChunks` 与 `AssistantStreamRecord`。

Definition 不再提供归一化、重试、请求归属、能力查询或稳定错误码；适配器错误原样传播。`types.ts` 和 `assembler.ts` 是仅有的两个内部模块，接口随实现调整；普通消费者优先使用公开入口。

## 相关文档

- [包 README](../../packages/llm/llm/README.md) —— 完整行为、限制与源码地图。
- [模块依赖](../../packages/llm/DEPENDENCIES.md) —— 内部文件依赖图、外部依赖与测试映射。
- [DeepSeek Provider README](../../packages/llm/llm-deepseek/README.md) —— 线上映射与配置。

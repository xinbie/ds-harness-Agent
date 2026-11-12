---
description: "供应商中立的消息与流式词汇，以及 ctx.llm 模型能力接缝：适配器注册、按模型选择、llm/stream 瀑布流和可选的流装配。"
kind: "package-reference"
---

# @coridis/llm

中文

## 概述

`@coridis/llm` 是「模型」能力接缝的 Service Definition。它拥有 `ctx.llm`，定义与供应商无关的消息、内容块、工具 schema 和流式块词汇，并负责：

- 注册模型适配器；
- 按 `request.model` 精确选择适配器；
- 通过 `llm/stream` 瀑布流派发请求；
- 可选地把整条流装配成文本、工具调用和终止原因。

本包不做请求校验、消息归一化、重试、请求归属、能力查询或错误包装。适配器收到调用方传入的原始请求；适配器抛出的错误原样传播。提示词、压缩和会话记录由消费者或监听器拥有。

**状态：已实现。** 行为由本包 `tests/` 下的规格覆盖。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

挂载 `@coridis/llm`，再挂载至少一个注册到 `ctx.llm` 的适配器。消费者通过 `inject = ['llm']` 注入服务，并且只导入本包的类型。

### 挂载服务

```ts
import { Context } from '@deepseek-ai/cordis'
import LlmService from '@coridis/llm'

const ctx = new Context()
await ctx.plugin(LlmService)
```

`LlmService` 默认导出为 Cordis 插件；插件卸载时，服务及其注册随 Cordis 生命周期释放。

### 注册适配器

`ctx.llm.registerAdapter(adapter)` 注册一个适配器并返回 disposer。适配器声明自己的 `id`、它服务的模型集合，以及 `stream()`：

```ts
import type { LlmAdapter } from '@coridis/llm'

const adapter: LlmAdapter = {
  id: 'echo',
  models: ['echo-model'],
  async *stream() {
    yield { type: 'text-delta', text: 'hello' }
    yield { type: 'finish', reason: 'stop' }
  },
}

const dispose = ctx.llm.registerAdapter(adapter)
// 之后：
dispose() // 从注册表移除该适配器
```

注册只检查两件事：

- `id` 不能与已注册适配器重复；
- 模型集合不能与已注册适配器重叠。

冲突会抛普通 `Error`，且不会部分注册。disposer 只在注册表当前仍持有同一个适配器实例时才移除它。

### 发起一次请求

`ctx.llm.stream(request)` 按 `request.model` 精确选择适配器，并返回 `AsyncIterable<StreamChunk>`：

```ts
const stream = ctx.llm.stream({
  model: 'deepseek-chat',
  messages: [{ role: 'user', content: 'Hello' }],
  tools: prompt.tools,
  signal: controller.signal,
})

for await (const chunk of stream) {
  if (chunk.type === 'text-delta') process.stdout.write(chunk.text)
  else if (chunk.type === 'tool-call') calls.push(chunk.call)
  else console.log(chunk.reason)
}
```

请求原样传给适配器，不做归一化。`messages` 使用本包的供应商中立词汇；`tools` 和 `signal` 可选。流块有三种：

| 流块 | 载荷 | 含义 |
|---|---|---|
| `text-delta` | `text` | 增量文本 |
| `tool-call` | `call`（`id`、`name`、原始 `arguments` JSON 字符串） | 模型请求的一次工具调用 |
| `finish` | `reason`：`stop`、`tool-calls`、`length`、`error` | 终止块 |

### 词汇与类型

| 类型 | 形状 | 用途 |
|---|---|---|
| `Role` | `'system' \| 'user' \| 'assistant' \| 'tool'` | 消息角色 |
| `TextBlock` | `{ type: 'text'; text }` | 纯文本内容 |
| `ToolCallBlock` | `{ type: 'tool-call'; id; name; arguments }` | 模型请求的工具调用；`arguments` 是原始 JSON 字符串 |
| `ToolResultBlock` | `{ type: 'tool-result'; toolCallId; content; isError? }` | 回填给模型的工具结果 |
| `ContentBlock` | `TextBlock \| ToolCallBlock \| ToolResultBlock` | 内容块联合 |
| `Message` | `{ role; content: string \| readonly ContentBlock[] }` | 一条供应商中立消息 |
| `ToolSchema` | `{ name; description; parameters }` | 给模型的工具声明 |
| `FinishReason` | `'stop' \| 'tool-calls' \| 'length' \| 'error'` | 终止原因 |
| `StreamChunk` | `text-delta \| tool-call \| finish` | 流块联合 |
| `StreamRequest` | `{ model; messages; tools?; signal? }` | 一次模型请求 |
| `LlmAdapter` | `{ id; models; stream(request) }` | Provider 必须实现的契约 |

### 流装配

需要一次性拿到完整文本和工具调用时，用 `assembleStream()` 消费整条流：

```ts
import { assembleStream } from '@coridis/llm'

const result = await assembleStream(ctx.llm.stream(request))
result.text       // 拼接后的文本
result.toolCalls  // 按产出顺序排列
result.reason     // 终止原因
```

`assembleStream()` 只负责拼接和收集；它不校验块形状，也不合并 `chunks` 数组。流结束时没有 `finish` 块会抛普通 `Error`。

### 包装或替换请求

`ctx.llm.stream()` 通过 `llm/stream` 瀑布流派发。监听器接收调用方的请求和 `next()`，必须调用 `next()` 才能委托给所选适配器：

```ts
ctx.on('llm/stream', (_request, next) => (async function* () {
  for await (const chunk of next()) {
    record(chunk)
    yield chunk
  }
})())
```

监听器可以实现记录、指标或整体替换流。适配器选择发生在进入瀑布流之前，因此未被任何适配器服务的模型会同步抛错，监听器无法“补救”一个无人服务的模型。

## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释本包如何实现上述行为；可观察的契约在[使用本包](#use-this-package)中说明。

### 设计概念

接缝把“模型调用”拆成定义与提供方两半：本包只拥有中性词汇、注册表、选择规则和一条瀑布流，真正的线上调用由适配器完成。这样切换 provider 只需替换挂载的适配器，而不改消费者代码。

模型所有权通过“不相交的模型集合”维持：每个适配器声明它服务的模型，注册表拒绝任何重叠，因此按模型查找最多命中一个适配器。

### 选择与注册

按 `request.model` 做精确字符串匹配，取第一个（也是唯一一个）声明了该模型的适配器；找不到时立即抛出 `no llm adapter serves model "<model>" (...)`，错误信息会列出已注册的适配器 id 或说明尚无适配器。

`registerAdapter` 通过 `ctx.effect()` 注册，因此适配器随插件或作用域卸载而移除。返回的 disposer 与 effect 的清理逻辑都会检查注册表当前值是否仍是同一个适配器实例，避免过期句柄移除替代者。`listAdapters()` 与 `models()` 仅用于诊断，按注册顺序返回。

### 流装配

`assembleStream()` 把异步流收集为数组，再交给 `assembleChunks()` 拼接文本、收集工具调用并读取最后一个 `finish` 的原因。`chunks` 保留原始块顺序，不做压缩；缺少 `finish` 是错误。

### 事件契约

`llm/stream` 是瀑布流事件，签名如下：

```ts
'llm/stream'(
  request: StreamRequest,
  next: () => AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk>
```

监听器必须调用 `next()` 才能委托给所选适配器；不调用 `next()` 即完全替换请求行为。请求未经归一化，监听器看到的就是调用方传入的对象。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `LlmService`、注册、选择、`llm/stream` 声明与聚合导出 |
| [`src/types.ts`](src/types.ts) | 消息、内容块、工具 schema、请求与流块词汇 |
| [`src/assembler.ts`](src/assembler.ts) | `assembleStream()` / `assembleChunks()` |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [模块指南](../../../docs/llm/README.md) —— 每个源模块一篇文档，各配一个最小示例。
- [模块依赖](../DEPENDENCIES.md) —— 内部文件依赖图、外部包依赖、测试映射和消费者清单。
- [架构总览](../../../docs/architecture.md) —— 插件树与能力接缝。
- [能力接缝](../../../docs/capability-seams.md) —— Definition / Provider / Consumer 三种角色与选择规则。
- [DeepSeek 适配器](../llm-deepseek/README.md) —— 本仓库随附的 Provider。
- [agent-loop](../../core/agent-loop/README.md) —— `ctx.llm` 的主要消费者。

-----

<a id="model-experience"></a>
## 模型体验

### 请求与流

#### 模型看到什么

本包本身不决定模型看到什么：它只传递消费者构造的 `messages` 和 `tools`，再由适配器翻译成线上格式。最终提示词内容、工具声明和消息顺序由消费者决定，线上映射由适配器决定。

#### Token 影响

本包不裁剪、不压缩、不缓存消息；每次 `stream()` 调用都会把消费者提供的完整历史交给适配器。重试和调用选项由消费者或监听器自行实现。

#### KV 缓存影响

本包不添加缓存指令，也不改变消息字节；前缀是否可复用取决于消费者在相邻请求之间是否保持相同前缀，以及适配器是否原样传输。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本包何时需要特别留意。它们是当前包的约束，不是任务积压。

- **不做请求校验** —— `model`、消息和工具声明按调用方提供的形状直接传递；非法输入由适配器或消费者负责。
- **不做错误归一化** —— 适配器抛出的错误原样传播，没有稳定错误码或 `adapterId` / `model` 字段。
- **没有重试** —— 重试、退避和熔断属于消费者或 `llm/stream` 监听器。
- **没有调用选项** —— `maxTokens`、`temperature`、`stop`、单次超时不在词汇中；需要时由 Provider 配置或监听器扩展。
- **没有请求归属** —— 本包不生成请求 id，也不发送诊断头。
- **没有能力查询** —— 适配器只声明 id 和模型；工具支持、上下文窗口等能力不在契约中。
- **选择是精确字符串匹配** —— 不支持别名、通配符或模型家族匹配。
- **每个模型只能有一个适配器** —— 没有回退链或按优先级选择；需要回退时应在 `llm/stream` 监听器中实现。
- **选择先于瀑布流** —— 未被任何适配器服务的模型会在监听器运行前抛错。
- **装配器不做校验** —— `assembleStream()` 只拼接文本、收集工具调用；块形状和顺序由适配器保证。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

保持这一层最小：注册、选择、瀑布流、装配。不要在 Definition 中重新引入消息归一化、错误码、重试、归属或能力目录，除非有当前生产消费者需要；这些逻辑更适合放在 `llm/stream` 监听器或 Provider 中。新增词汇时，同步更新 `types.ts`、本 README、`docs/llm/types.md` 和 `DEPENDENCIES.md`。

</details>

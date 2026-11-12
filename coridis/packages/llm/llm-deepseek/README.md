---
description: "ctx.llm 的 DeepSeek 适配器提供方，把供应商中立的消息与工具映射到 OpenAI 兼容的 /chat/completions 线上格式。"
kind: "package-reference"
---

# @coridis/llm-deepseek

中文

## 概述

`@coridis/llm-deepseek` 是「模型」能力接缝的 Service Provider。它向 `ctx.llm` 注册一个适配器，把与供应商无关的 `Message` 和 `ToolSchema` 翻译成 OpenAI 兼容的 `/chat/completions` 请求，再把响应映射回 `StreamChunk`：非空文本成为 `text-delta`，每个工具调用成为 `tool-call`，最后以 `finish` 结束。

`baseURL`、`model`、`apiKeyEnv` 和 `timeoutMs` 可配置；API key 在每次请求时从环境变量读取。适配器只做线上格式转换，不重试，也不校验请求。

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

在挂载 `@coridis/llm` 之后挂载本提供方。它注入 `llm` 服务，并在插件加载时注册一个 DeepSeek 适配器；插件卸载时通过 `ctx.effect` 自动注销。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `id` | `'deepseek'` | 适配器 id；用于诊断和重复检测 |
| `model` | `'deepseek-chat'` | 默认模型 id，也是该适配器声明服务的唯一模型 |
| `baseURL` | `'https://api.deepseek.com'` | OpenAI 兼容端点基址；末尾斜杠会被去除 |
| `apiKeyEnv` | `'DEEPSEEK_API_KEY'` | 保存 API key 的环境变量名；在每次请求时读取 |
| `timeoutMs` | `120000` | 单次请求的超时毫秒数 |

### 挂载

通过 bundle 补丁挂载：

```yaml
- name: '@coridis/llm-deepseek'
  config:
    model: deepseek-chat
    apiKeyEnv: DEEPSEEK_API_KEY
```

或以编程方式挂载：

```ts
import * as deepseek from '@coridis/llm-deepseek'
import { LlmService } from '@coridis/llm'

await ctx.plugin(LlmService)
await ctx.plugin(deepseek, {
  model: 'deepseek-chat',
  baseURL: 'https://api.deepseek.com',
  apiKeyEnv: 'DEEPSEEK_API_KEY',
})
```

一个适配器实例只声明一个模型。若要服务多个模型，请挂载多个实例并为每个实例配置不同的 `id` 和 `model`；模型集合必须互不重叠，否则注册会被拒绝。

### 发起请求

```ts
const stream = ctx.llm.stream({
  model: 'deepseek-chat',
  messages: [{ role: 'user', content: 'Explain this diff.' }],
})
```

请求原样传给适配器；本包只读取 `model`、`messages`、`tools` 和 `signal`。

### 请求映射

`StreamRequest.messages` 按角色转换为线上消息：

- `system` / `user`：拼接所有 `text` 块为 `content`；
- `assistant`：拼接 `text` 块；若结果为空则 `content` 为 `null`；`tool-call` 块转换为 `tool_calls` 数组，保留 `id`、函数名和原始 `arguments` 字符串；
- `tool`：每个 `tool-result` 块成为一条独立的线上 `tool` 消息，携带 `tool_call_id`；`isError: true` 时内容加上 `Error: ` 前缀；其他类型的块被跳过。

`StreamRequest.tools` 转换为 `{ type: 'function', function: { name, description, parameters } }` 数组；没有工具时省略该字段。请求体固定 `stream: false`，因此底层传输是一次性 JSON 响应。

### 响应映射

适配器解析第一个 `choice`：

- `message.content` 为非空字符串时产出一个 `text-delta`；空字符串不产出；
- 每个 `tool_calls` 项产出一个 `tool-call`，`arguments` 为空时补为 `'{}'`；
- 最后产出一个 `finish`：存在工具调用时 `reason` 为 `'tool-calls'`，否则 `finish_reason` 为 `'length'` 时取 `'length'`，其余取 `'stop'`。

即使没有任何文本或工具调用，成功响应也总会以 `finish` 结束。

### 超时与取消

适配器为每次请求创建 `AbortController`：调用方 `signal` 的 `abort` 事件会以相同 `reason` 触发内部中止；`timeoutMs` 到期后以 `DeepSeek request timed out` 中止。定时器调用 `unref()`，不会单独阻止进程退出。`finally` 中统一清除定时器并移除事件监听器。

### 错误处理

适配器抛出普通 `Error`，`ctx.llm.stream()` 不包装它；消费者看到的 `message` 就是下表内容：

| 情况 | 错误消息 |
|---|---|
| 缺少 API key | `DeepSeek API key is missing: set <apiKeyEnv> before running coridis` |
| HTTP 非 2xx | `DeepSeek request failed (<status>): <响应体，最多 500 字符>` |
| 响应不是合法 JSON | `DeepSeek returned invalid JSON: <响应体，最多 500 字符>` |
| 响应包含 `error` 字段 | `DeepSeek error: <message>` |
| 响应没有 `choices` | `DeepSeek returned no choices` |
| 超时 | `DeepSeek request timed out` |

取消沿用调用方的 `AbortSignal`：适配器把它转发给内部的 `AbortController`，并在请求结束时移除监听器和定时器。取消不会转成稳定错误码。

## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释本包如何实现上述行为；可观察的契约在[使用本包](#use-this-package)中说明。

### 设计概念

本包是一层很薄的线上格式转换器。它不拥有历史、提示词或策略：调用方给它 `StreamRequest`，它负责把中性消息和工具声明翻译成 DeepSeek 的请求体，再把一次性响应拆成中性流块。适配器实例在创建时固定 `model`、`baseURL`、`apiKeyEnv` 和 `timeoutMs`，并通过 `ctx.effect` 注册到 `ctx.llm`，因此生命周期跟随插件。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口（`name`、`inject`、`Config`、`apply`）、适配器创建、请求与响应映射、超时和取消 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [模型接缝定义](../llm/README.md) —— `ctx.llm` 的注册、选择和 `llm/stream` 瀑布流。
- [模块指南](../../../docs/llm/deepseek.md) —— Provider 的最小使用示例。
- [模块依赖](../DEPENDENCIES.md) —— 源文件依赖图、外部包依赖和消费者清单。
- [架构总览](../../../docs/architecture.md) —— 插件树与能力接缝。
- [能力接缝](../../../docs/capability-seams.md) —— Definition / Provider / Consumer 三种角色。
- [agent-loop](../../core/agent-loop/README.md) —— 组装消息、调用 `ctx.llm.stream()` 并消费流块的主要消费者。

-----

<a id="model-experience"></a>
## 模型体验

### 消息与工具映射

#### 模型看到什么

模型收到的是 DeepSeek 的线上格式：`system`、`user`、`assistant` 文本消息，带 `tool_calls` 的 assistant 消息，以及带 `tool_call_id` 的 `tool` 结果消息。工具以函数声明数组发送，每项包含名称、描述和参数 JSON Schema。

#### Token 影响

适配器不裁剪、不摘要，也不丢弃历史；调用方传入的每条消息都会出现在请求中。工具 schema 会在每次请求中完整重复。Token 成本主要由调用方的历史构造和工具集合决定。

#### KV 缓存影响

消息顺序和逐块内容被原样保留，没有添加缓存指令或顺序调整。前缀复用取决于调用方在相邻请求中保持相同前缀；`stream: false` 只影响响应传输方式，不改变请求前缀。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本提供方何时需要特别留意。它们是当前包的约束，不是任务积压。

- **传输是非流式的** —— 请求体固定 `stream: false`，适配器要等完整响应到达后才产出一个 `text-delta`；接口虽然是 `AsyncIterable`，但并不提供逐 token 增量。
- **一个实例只服务一个模型** —— 不支持模型别名或模型家族；多模型需要多个实例，且模型集合必须互不重叠。
- **不重试** —— 失败直接抛出；重试属于消费者或 `llm/stream` 监听器。
- **没有调用选项** —— `maxTokens`、`temperature`、`stop`、单次超时覆盖不在契约中；只有配置级的 `timeoutMs`。
- **没有归属头** —— 不发送 `x-request-id` 或 `x-coridis-*` 诊断头。
- **没有能力声明** —— 不声明工具支持或上下文窗口。
- **没有用量统计** —— 响应中的 token 用量不会被读取或暴露。
- **不支持多模态内容** —— 词汇只有文本、工具调用和工具结果块，没有图像或文件块。
- **超时覆盖整个请求** —— 没有区分连接、首字节和读取阶段的独立超时。
- **工具参数不做校验** —— `arguments` 作为原始 JSON 字符串原样透传；合法性由模型和消费者负责。
- **`finish.reason: 'error'` 不会由本适配器产出** —— 失败统一走抛出路径。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

本包只做线上格式转换。不要把重试、压缩、会话记录、提示词组装或调用选项加到这里——重试属于消费者，压缩与组装属于监听器或消费者。新增配置字段或映射时，请同时更新上表、`Config` / 映射注释、规格测试和 bundle 补丁示例。错误消息是下游可见契约：不要给消息加前缀。

</details>

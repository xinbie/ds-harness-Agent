# @coridis/session

Append-only Session event log and the `ctx.sessions` service.

**状态：已实现。** 行为由本包 `tests/session.spec.ts` 覆盖。

## 概述

`@coridis/session` 把一次对话中模型可见的事实记录成只追加的事件日志，并从日志派生 provider 中立的 `Message[]`。它是 `ctx.sessions` 的 Service Definition：

- `create()` 创建内存会话并发布 `session/created`；
- `append()` 分配单调递增的 `seq`，然后发布 `session/event`；
- `deriveMessages()` 把日志投影成 `user`、`assistant`、`tool` 消息。

当前实现只做内存存储，不包含持久化、恢复、分叉、压缩或事件校验。这些能力属于未来的 Provider 或独立包，不属于这个最小 Definition。

> `src/core/session` 是从上游 DeepSeek Harness 逐字复制的参考快照，不参与构建；本文件描述的是工作区实际使用的 `packages/core/session`。

## 快速开始

```ts
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { createSessionId } from '@coridis/session'

const ctx = new Context()
await ctx.plugin(SessionStore)

const session = ctx.sessions.create({
  id: createSessionId(),
  cwd: '/workspace',
})

session.append({ type: 'turn/start', data: { turnId: 't1', input: ['hello'] } })
session.append({ type: 'user/message', data: { text: 'hello' } })
session.append({ type: 'assistant/message', data: { text: 'hi', toolCalls: [] } })

console.log(ctx.sessions.deriveMessages(session))
// [
//   { role: 'user', content: 'hello' },
//   { role: 'assistant', content: 'hi' },
// ]
```

监听日志：

```ts
ctx.on('session/created', session => {
  console.log('created', session.id)
})

ctx.on('session/event', (session, event) => {
  console.log(session.id, event.seq, event.type)
})
```

## API

| API | 行为 |
|---|---|
| `createSessionId()` | 生成 UUID 作为不透明会话 id |
| `ctx.sessions.create(header)` | 创建会话，自动写入 `createdAt`；id 重复时抛出 `session "<id>" already exists` |
| `ctx.sessions.get(id)` | 按 id 查找活动会话；不存在返回 `undefined` |
| `ctx.sessions.deriveMessages(session)` | 从事件日志派生新的 `Message[]` |
| `session.append(event)` | 追加事件，返回分配到的 `seq`，并发布 `session/event` |
| `session.events` | 按 `seq` 排列的当前事件数组 |
| `session.header` / `session.id` | 创建时写入的不可变元数据 |

`SessionHeader` 包含 `id`、`createdAt`，以及可选的 `cwd`。

## 事件词汇

`SessionEventData` 定义了 11 种持久事实：

| 事件 | 载荷 | 生产者 | 参与 `deriveMessages` |
|---|---|---|---|
| `turn/start` | `turnId`、`input` | agent-loop | 否 |
| `turn/end` | `turnId`、`status` | agent-loop | 否 |
| `step/start` | `turnId`、`step` | agent-loop | 否 |
| `step/end` | `turnId`、`step`、`reason` | agent-loop | 否 |
| `prompt/assembled` | `turnId`、`step`、`system`、工具名 | agent-loop | 否；保留模型可见提示词的审计记录 |
| `user/message` | `text` | agent-loop | 是 |
| `assistant/message` | `text`、`toolCalls` | agent-loop | 是 |
| `tool/call` | `callId`、`name`、`arguments` | agent-loop | 否；记录调用已开始，即使没有结果 |
| `tool/result` | `callId`、`name`、`content`、`isError` | agent-loop | 是 |
| `run/error` | `message`、`stack` | agent-loop | 否；诊断信息 |

所有事件在写入时都会补上 `seq`。`SessionEventInput` 是写入前的形状：`type` + `data`，不含 `seq`。

## 派生规则

`deriveMessages()` 按日志顺序遍历事件：

- `user/message` → `{ role: 'user', content: text }`；
- `assistant/message` → 非空文本转成 `text` 块，每个工具调用转成 `tool-call` 块；只有单个文本块时 `content` 直接是字符串，否则是块数组；
- `tool/result` → `{ role: 'tool', content: [{ type: 'tool-result', ... }] }`，保留 `isError`；
- 其他事件跳过。

派生结果每次都是新数组，不会缓存，也不会修改日志。

## 生命周期与顺序

1. `create()` 先检查重复 id，再构造 `createdAt`，插入 `Map`，最后发布 `session/created`。
2. `append()` 用当前数组长度作为 `seq`，先 push，再发布 `session/event`。
3. `seq` 从 `0` 开始，单调递增；删除或重排事件不受支持。
4. 进程退出即丢失全部会话；本包没有持久化后端或 `dispose()` 会话的 API。

## 防御性冗余审计

本轮按“当前使用场景是否真的需要”逐项检查：

| 候选项 | 结论 | 依据 |
|---|---|---|
| `SessionEventInput` 的 `infer` 条件类型 | **已移除** | 直接用映射类型展开，类型等价且更易读 |
| 重复 id 检查 | 保留 | 防止 `Map.set` 静默覆盖已有日志；测试覆盖 |
| `createdAt` / `cwd` | 保留 | 会话头元数据；agent-loop 创建时使用 `cwd` |
| 11 种事件类型 | 保留 | 全部由 agent-loop 写入；部分用于诊断/回放 |
| `tool/call` | 保留 | 记录“调用已开始”，即使 `tool/result` 缺失也能区分 |
| `prompt/assembled.system/tools` | 保留 | 模型可见提示词的持久审计记录 |
| `run/error.stack` | 保留 | 失败诊断；headless 会输出事件 JSON |
| `SessionHandle.id` getter | 保留 | `Session` 接口要求，且与 `header.id` 同源 |
| 单文本块折叠为字符串 | 保留 | 产出更简单的中立 `Message`；测试覆盖 |
| 上游快照中的 fork/surface/projection/JSON 冻结 | 不处理 | 位于 `src/core/session`，是逐字复制的参考代码，不参与构建 |

结论：运行时没有可安全删除的防御性代码；当前 API 和事件都有实际消费者。唯一删除项是类型层的过度设计。

## 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 全部类型、`SessionHandle`、`SessionStore`、事件声明与默认插件导出 |
| [`tests/session.spec.ts`](tests/session.spec.ts) | 创建、重复 id、`seq`、派生历史、工具消息、id 生成 |

## 延伸阅读

- [架构](../../../docs/architecture.md) —— 插件树、会话日志与 turn flow。
- [能力接缝](../../../docs/capability-seams.md) —— Definition / Provider / Consumer 的角色划分。
- [agent-loop](../agent-loop/README.md) —— 主要写入方：每个 turn/step、消息和工具结果。
- [headless](../../bundle/headless/README.md) —— 读取 `session/event` 并输出事件流。
- [上游会话快照](../../../src/core/session/README.md) —— 完整的持久化/分叉/投影参考实现，非本包运行时。

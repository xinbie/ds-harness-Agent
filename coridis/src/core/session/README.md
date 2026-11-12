---
description: "面向用户与维护者的事件溯源会话日志与内存存储，用于构建、检查或扩展每次 agent 交互背后的持久记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session

中文

## 概述

`dsh-session` 把每个模型可见的事实记录进一份仅追加的会话日志，并从该记录派生模型历史。消费者可以检查、重放、分叉和刷新会话，同时保留历史事件；压缩会从当前对话中隐藏已被取代的条目，但不会删除它们。除非添加持久化后端，会话都留在内存中，而持久性检查点会等待已配置的后端。任何需要可重建会话记录的 agent 都应选用本包；它本身不调用模型。

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

在任何需要有会话的地方挂载 `dsh-session`。它在内存中创建并持有事件溯源的 `Session` 实例；持久化插件通过订阅 `session/event` 事件流把持久存储叠加其上。

### 创建和检查会话

`ctx.sessions.create()` 构建一个绑定到调用 fiber 的活动会话；`get(id)` 和 `list()` 查找会话，`fork()` 从活动会话的稳定前缀创建独立会话。它复制历史、`cwd`、`isSeeded` 和继承的事件数，但不会记录来源关系。`parentSession` 记录子 agent 的直接创建者；历史上的普通分叉可能在那里保留其来源，因此分类时应使用 `origin`。

独立的 `Session.create()` 和 `Session.fromRestore()` 实例接受事件和插件记录，但不会发送 `session/event`。`SessionStore` 通过 `prepare()` 或 `enter()` 取得所有权；此后写入要求存储成员资格和已完成的同步 `session/created` 公告。创建监听器是只读的，并能看到所有既有历史；进入一个独立实例不会把该历史作为 `session/event` 重放。公告或移除失败会让写入保持禁用。只有在 `session/created` 已开始（包括公告失败）时，移除才会发出 `session/disposed`；进入但从未公告的实例两个通知都不发。

```text
const session = ctx.sessions.create(sessionId, { meta: { cwd: '/workspace' } })
ctx.sessions.get(sessionId)      // the live session
ctx.sessions.list()              // every live session, in creation order
```

### 追加与派生

`session.append(type, data, opts?)` 提交一个强类型事件。它在读取载荷字段之前拒绝只读实例，对有效 JSON 做快照并冻结，然后在提交和通知观察者之前重新检查写权限。`session.deriveMessages()` 将日志投影为模型看到的 `Message[]`，以增量和缓存方式进行：

```text
session.append('user/message', { role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } },
  { surfaceOp: 'append' })
session.deriveMessages()         // the derived model history
```

表面事件（`system/message`、`developer/message`、`user/message`、`assistant/message`、`tool/result`）在强类型事件和追加输入中都要求 `surfaceOp`。替换使用恰好 `{ op: 'replace', startSeq, endSeq }`，端点是在当前表面顺序中闭区间的 `SessionSeq`。Assistant 消息内嵌其确切的紧凑 provider 流，并禁止 `sourceEventSeqs`。已知的仅日志事件禁止这两个元数据字段，且永远不会产生消息。

`developer/message` 存储工具新增项的名称，以及指向更早 `request/header` 的 `headerSeq` 引用。只有当存在新增项时才需要该引用，且每个名称都必须在该头部中标识恰好一个完整 schema。移除项只命名工具，不带头部引用。历史头部在重启、分叉和表面替换之后仍然可用；当前注册表和最新头部不会为更早的新增项选择定义。`sourceEventSeqs` 继续描述派生和被替换的节点。

插件通过 `@messageProjection` 声明会改变内容的事件，并通过 `ctx.sessions.registerMessageProjection()` 注册纯定义。Session 在接受事件之前调用该定义，并缓存其不可变的消息更新。缺失定义会拒绝追加与恢复；卸载已使用的定义同样会阻止缓存读取。分离的构造函数和 `foldSurface(events, projections)` 需要显式定义。重建器把折叠的 `projectedMessages` 传给 `deriveEventMessage()`；活动实例方法会自动应用同样的投影。[插件拥有的消息投影](../../../.agents/notes/implemented/architecture/2026-09-11-plugin-owned-message-projections.md)定义了所有权和离线组装。

追加、种子/恢复，以及事件采纳/快照都会拒绝任何 `header.system` 和恰好为空的请求头可选字段（`tools: []`、`adapterDefaults: {}`），而不是对输入做规范化。工具结果 `data.error` 仅在头等消息满足 `isError === true` 时才被允许；失败身份保持可选。被拒绝的追加不会改变日志、派生状态或事件流。采纳会校验事件局部元数据，但不校验被引用的历史或替换成员资格。

`system/message` 持有渲染后的系统提示词：第一个是表面节点 0，准备好的调用能力决定准入，在不支持能力的路由上非空渲染会合并到第一个系统节点，或在持续进行的 `in-history` 序列中追加到缓存历史之后；空系统节点投影为无消息，因此清空提示词需要对所有活跃系统节点记录空替换，而不仅仅是最近的那个；当节点 0 是 `system/message` 时，表面折叠会拒绝覆盖节点 0 的替换，除非替换事件本身是恰好覆盖该节点的 `system/message`，而更晚的系统节点没有这层保护，压缩范围可以遮蔽它们（[决策](../../../.agents/notes/implemented/architecture/2026-09-02-system-prompt-as-surface-node.md)）。

### 读取日志

`session.seq` 读取当前日志长度而不物化数组，`session.eventAt(seq)` 按序号读取一个已接受、深度冻结的事件。`session.snapshotEvents(fromSeq?, toSeqExclusive?)` 物化半开区间的冻结、稳定快照；完整的当前快照会被缓存，直到下一次追加。`eventAt()`、`snapshotEvents()` 和 `ownEvents()` 已弃用：现有逻辑目前可以暂不迁移，但禁止新的生产调用。仓库测试文件可以在其作用域内的 lint 许可下使用这三个读取器（[策略](../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md)）。只需要长度的调用方应使用 `seq`。

会话日志位置使用两种数值类型。`SessionSeq` 标识一个现存事件或闭区间事件水位；`SessionLogOffset` 标识一个间隙、前缀长度或读取边界，可以等于事件数。`SessionSeqCursor` 增加 `-1` 这一“尚无事件”值，而 `OptionalSessionSeq` 在“缺失即数据”时使用 `null`。构造函数会校验非负安全整数，且这些品牌标记在运行时消失，因此持久 JSON 和线上值仍是普通数字。

<a id="write-experimental-plugin-records"></a>

### 写入实验性插件记录

`appendPluginRecord(session, type, data)` 为 `packages/experimental/` 下的包追加一条插件记录；`verify-plugin-record-callers` 检查会拒绝本仓库中任何其他生产调用方。本仓库之外的插件同样不得调用它，尽管没有仓库检查能发现它们。

通过在 `@deepseek-ai/dsh-session/types` 中为 `PluginRecordMap` 声明每条记录，并在拥有该记录实验包的 `src/` 中提供描述和显式载荷类型注解。名称使用 `plugin:<owner>/<record>`，其中 `owner` 是包名 `@deepseek-ai/dsh-experimental-<owner>` 的后缀；例如 `plugin:pi-extensions/entry`。TypeScript 会对照声明检查每个名称和载荷；写入方的运行时 JSON 快照会拒绝无法无损保留的值。把扩展定义的或其他动态名称放进已声明记录的载荷中。

[实验性持久化目录](../../../docs/experimental-persistence-catalog.md)列出了当前的插件记录声明及其所有者、描述、载荷类型注解和源文件。这些声明与 `SessionEventMap`、扩展的持久化 schema、已发布的类型历史和 `KNOWN_SESSION_EVENT_TYPES` 保持分离。记录携带 `ignorable: true`：不识别某条记录的构建会在读取时保留并跳过它。记录永远不会进入模型可见表面。恢复和分叉会连同日志其余部分携带它们；会话格式迁移会尽力保留它们。

`pluginRecordOf(event)` 把事件作为记录返回，对其他任何事件返回 `undefined`；某个 `ctx.sessionProjections` 单元若把每个事件都传给它，就能在恢复时重建插件状态。即使当前映射声明了该名称，其 `data` 仍保持 `unknown`。所有者必须在使用前校验它，因为更早的构建可能写入不同的载荷，而且 V3 到 V4 的格式边界可能把未知的可忽略 V3 事件重命名到同一个 `plugin:` 命名空间。移除或重命名声明不会丢弃已存储的记录。[可忽略事件决策](../../../.agents/notes/implemented/architecture/2026-08-30-retain-ignorable-external-session-events.md)拥有兼容性策略。

### 分叉会话

`ctx.sessions.fork(source, boundary?, childSessionId?)` 从活动源复制一个确切的闭区间事件前缀（默认：最后一个事件）。`dsh-session/fork` 中的 `buildForkSeed` 在复制的事件之后放置一个继承标记，只为打开的步骤添加缺失的错误工具结果，并以 `forked` 原因关闭该步骤和轮次。已关闭的步骤和轮次保持不变，包括历史上缺失的结果。标记和关闭器属于子会话；`inheritedEventCount` 只统计被复制的前缀。

逻辑字段 `SessionHeader.isSeeded` 报告是否存在分叉历史，而不暴露位置整数。`Session.inheritedEventCount` 保留经过校验的确切 `SessionLogOffset`；`ownEvents()` 返回该切点及之后的事件，`isOwnSeq(seq)` 只接受一个现存且属于子会话的位置。底层种子构造函数必须显式提供 `seed` 和 `inheritedEventCount`，因为构造函数种子可能包含位于继承前缀之后的子会话自有初始化事件。

### 刷新持久状态

`ctx.sessions.flush(session)` 派发可等待的持久性检查点：每个持久化监听器都会刷新，调用在所有监听器完成后才结算。需要立即持久性屏障的生产者应等待它，而不是假设 write-behind 已排空。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释本包如何实现上述行为；可观察的契约在[使用本包](#use-this-package)中说明。

### 设计概念

本包构建在事件溯源之上：`Session` 是一份仅有追加的强类型 `SessionEvent` 日志，其余一切——模型历史、转录、遥测、标题、持久化——都从该流派生。表面是一个派生的投影：一个增量管理器校验追加候选、从已提交事件推进有序视图，并跟踪位置替换的 `replaceGeneration` 以及替换和插件拥有消息变更的 `contentGeneration`。模型可见即已记录：任何进入模型请求的内容都必须能从日志重建。每个到达结算的模型尝试都会提交一个事件：`assistant/message` 携带组装好的模型可见消息及其紧凑的定时流，而 `assistant/attempt` 保留一次失败、重试、取消或流出错的尝试，同时不加入模型历史。结算之前的硬性进程丢失不会留下任何持久尝试流。

### 请求头

`request/header` 存储非历史请求信封的完整规范快照，原因为 `initial`、`resume`、`change` 或 `series`。显式的消息序列起点、表面替换或插件拥有的消息变更，在信封未变时会写入 `series` 快照；同时发生变更时使用 `startsSeries: true`。同序列步骤、重试以及后续普通轮次继承最新快照。`adapterDefaults` 区分由适配器解析的值和显式设置，`foldRequestHeader()` 选择最新快照。这条自包含记录支持部分窗口渲染和精确重建，代价是每个消息序列都会增长；[可重建请求 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md)拥有细节。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`SessionStore` 服务、存储生命周期、`fork`、`flush` |
| [`src/types.ts`](src/types.ts) | `SessionEventMap`、`SessionEvent`、`UserMessage`、`SessionHeader`、`TurnEndReasonMap` |
| [`src/surface.ts`](src/surface.ts) | 有序表面投影、替换校验、`deriveEventMessage` |
| [`src/request-header.ts`](src/request-header.ts) | `request/header` 折叠与重建 |
| [`dsh-util-values`](../../util/values/README.md) | 共享的无损 JSON 校验与分离快照 |
| [`src/repair.ts`](src/repair.ts) | 针对失败步骤、被中断日志和分叉种子的共享工具结果恢复 |

### 追加校验

每次追加都使用共享的迭代式 `snapshotJsonValue()` 过程，它读取、校验并复制每个嵌套值一次，因此有状态的 getter 无法给校验提供一个值、给存储提供另一个值。非无损 JSON 载荷（BigInt、环、稀疏数组、`-0`、异型原型）会在追加处、任何后端刷新之前被拒绝。追加路径构造每个 `SessionSeq`；表面事件还会额外校验标记形状、引用的源事件序列，以及替换时对遮蔽节点的完整覆盖。

### 共享恢复

`ToolCallRecovery` 从已提交事件跟踪未应答的请求，而不保留事件历史。AgentLoop 观察活动步骤；崩溃恢复和分叉种子构造通过 `openTurnClosers` 重放各自的前缀。活动失败和崩溃恢复默认使用“被中断结果”的措辞；分叉构造会传入分叉原因，以选择其独特重试指引。调用方在关闭步骤之前追加恢复结果（[参考](../agent-loop/README.md)）。

### 派生历史

`deriveMessages()` 缓存深度冻结的投影，并在每次调用时返回新数组。表面事件类型（`system/message`、`developer/message`、`user/message`、`assistant/message`、`tool/result`）提供其记录的消息身份和内容；内容为空的 system 和 developer 节点投影为无消息。插件拥有的投影会改变派生内容，而不修改已记录的消息。替换和投影决策会使缓存失效。内嵌的 Assistant 流和 `assistant/attempt` 事件仍只作为重放和诊断数据。普通提示词和注入的上下文投影时不会自动添加类型或来源特定的包装。生产者在其记录内容中拥有任何框架文本。

### 请求头（实现）

循环在每次循环实例边界以及发生变化时记录一份完整规范的 `request/header` 快照（调用配置、适配器默认值、组装后的工具 schema——渲染后的系统提示词是 `system/message` 表面节点，而不是头部状态）；`foldRequestHeader(events)` 通过选择最新快照来重建它，使每个对话请求都成为日志的纯函数。路由元数据（`request/context`）是单独记录的日志状态，仅在 provider、model、容量或 `systemPromptUpdate` 模式不同时追加；它记录提示词和用户准入之后实际准备好的调用的模式，而不是提供该准入决策。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

对大多数消费者来说，包级契约已经足够；当你需要周边领域时，再阅读以下内容。

- [会话子系统](../../../docs/subsystems/session.md) —— 完整的事件词汇、表面类型和生成的服务 API。
- [持久化子系统](../../../docs/subsystems/persistence.md) —— 后端如何使这份日志持久化。
- [核心子系统](../../../docs/subsystems/core.md) —— 写入并从会话派生历史的循环。
- [生成的持久化目录](../../../docs/persistence-catalog.md) —— 每个会话事件及其载荷与声明位置。
- [核心组地图](../README.md) —— 核心各包如何组合。

-----

<a id="model-experience"></a>
## 模型体验

### 派生消息历史

#### 模型看到什么

模型会收到来自 `system/message`、`developer/message`、`user/message`、`assistant/message` 和 `tool/result` 表面条目的完整消息，并应用已记录的投影，系统提示词在最前。身份、角色、来源和未修改的块保留其原始值；投影永远不会铸造身份。直接提示词和注入的上下文仍是独立的 `user/message` 事件，其来源保留归属。内嵌流、`assistant/attempt`、边界和其他仅日志事实不添加任何消息。

#### Token 影响

追加的表面条目会在后续步骤中重新发送。`replace` 表面操作会从未来输入中移除被遮蔽的条目，而不删除其原始日志记录。

#### KV 缓存影响

追加的表面条目保留可复用的前缀。`replace` 操作会从第一条被遮蔽的消息起使复用失效，即使底层事件日志仍然仅追加。

### 工具结果恢复与分叉结果

#### 模型看到什么

如果恢复发现某个 assistant 工具请求没有持久的 `tool/call`，其合成的 `TOOL_NOT_STARTED` 结果为 `The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.` 如果某个持久 `tool/call` 没有结果，其 `TOOL_OUTCOME_UNKNOWN` 结果为 `The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.` 分叉生成的结果只描述继承的记录：父会话可能在所选事件之后已经开始或完成某个调用。`TOOL_NOT_STARTED` 表示前缀中没有开始记录；`TOOL_OUTCOME_UNKNOWN` 表示其中开始记录但没有结果。二者都告诉模型只重试只读或幂等操作，无需进一步检查；有副作用的操作需要外部验证或用户输入。见[分叉参考](src/fork.ts)。

#### Token 影响

完好会话中为零 token。每次被修复的调用都会把其保留的风险特定错误文本加入后续请求。

#### KV 缓存影响

仅追加；新可见内容跟在可复用的请求前缀之后，不会使已有的 KV 缓存条目失效。

### 已记录的请求头

#### 模型看到什么

会话从请求头重建活跃的工具 schema 和调用配置；provider 特定的延迟与保留声明在派发时派生。`toolHistory()` 缓存对已提交头部和 developer 消息的有状态折叠，后续读取时只消费尚未见过的事件。它通过历史 `headerSeq` 解析新增项，返回不可变快照，并在显式请求序列或保留定义变化时重启声明。以未变更定义恢复某个保留名称会继续该序列；已记录的新增项会重新提供它。循环请求和压缩调用都使用这一状态。缺少匹配更新记录的头部使用完整的活跃声明。允许同名 schema 变更，并且即使在 `in-history` 路由上也会使前缀复用失效；针对历史工具的注册时拒绝被推迟（[理由](../../../.agents/notes/implemented/architecture/2026-09-20-dynamic-tool-updates.md)）。系统提示词仍是 `deriveMessages()` 的一部分；头部事件不添加消息或提示词副本。

#### Token 影响

记录本身不会产生重复 token。系统节点和 schema 仍承担其正常的每请求开销。

#### KV 缓存影响

记录不会导致失效，精确重建会保留请求前缀身份。之后配置或 schema 变化的头部可能从其第一个差异起使复用失效；替换表面节点 0 的提示词变更会从第一个 token 起使复用失效，而 in-history 追加会保持穿过缓存历史的前缀可复用。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了会话存储何时需要特别留意。它们是当前包的约束，不是任务积压。

- **活动源存储 API** —— 已持久化但未加载的源使用 Host 观察路径。分叉只关闭打开的尾部，不会修复此前已关闭步骤中缺失的结果。
- **`SESSION_FORMAT_VERSION` 命名的是[当前逻辑表示](../../../docs/session-format-status.md)** —— 当前读取器拒绝已退役的 `header.system`，并校验 `system/message` 载荷和受保护头部的重写。历史头部和事件属于相邻的格式包；[相邻迁移链](../../session/session-format-catalog/README.md)在构造 `Session` 之前转换受支持的历史，而写打开路径只发布当前格式的后继者。同版本的未知事件要求信封上有显式的 `ignorable` 标记，该标记并不保证安全的结构迁移（[机制](../../../.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.md)）。[读取器兼容性](../../../.agents/notes/implemented/process/2026-10-08-session-reader-compatibility-review.md)决定一项变更是否需要提高版本。
- **`TurnEndReasonMap` 省略了 ACP 命名的 `refusal` / `max_turn_requests` 变体** —— 由生产者把关：当适配器或循环首次发出它们时才会落地。
- **除分叉之外没有会话树** —— 除非消费者需要比基于边界的分叉更多的东西，否则在分叉会话上实现 pi 风格的条目树会被推迟。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

无。

</details>

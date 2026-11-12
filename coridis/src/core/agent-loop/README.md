---
description: "面向用户与维护者的默认 agent 驱动，用于选择、配置或调试 agent 的创建方式以及轮次和步骤的运行方式。"
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-loop

中文

## 概述

`dsh-agent-loop` 创建全新 agent 或恢复已持久化的会话，然后驱动每个轮次经历模型请求、流式响应、工具执行和持久会话历史。为标准 agent 组合而挂载它；声明式条目在启动时启动 agent，而公共 `ctx.agents` API 支持编程式创建和恢复。选定的工具执行器拥有派发、并发、取消和工具日志。取消会保留已经交付给用户的流式文本。只有当标准的“调用模型、运行工具、重复”生命周期不够用时，才选择自定义 `Agent` 实现。

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

在任何应当运行 agent 的组合中挂载 `dsh-agent-loop`。它为 `ctx.agents` 提供背后的驱动，并启动你在其配置中声明的任何 agent；[`dsh-base`](../../bundle/base/README.md) 和 [`dsh-sdk-minimal`](../../bundle/sdk-minimal/README.md) 都将其作为显式条目挂载。

### 配置声明式 agent

配置中声明的 agent 会在插件加载时自动启动。每个条目需要一个 `id` 标签；模型步骤还需要在提示词组装之前，在 Session 选择或初始选项中有 `provider` 和 `model` 两者。

```yaml
- name: '@deepseek-ai/dsh-agent-loop'
  config:
    agents:
      - id: 'main'
        provider: deepseek
        model: deepseek-chat
        reasoningEffort: high
        cwd: /workspace
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `agents[].id` | 必填 | 稳定标签；除非设置 `sessionId`，新会话会生成 `${id}-session-<uuid>` |
| `agents[].provider` / `agents[].model` | — | 模型路由；二者在步骤准备之前都是必需的 |
| `agents[].reasoningEffort` | — | 非空的初始推理强度；后续选择记录在 Session 中 |
| `agents[].maxTokens` | — | 为正数的每请求输出 token 上限 |
| `agents[].cwd` | — | 新会话的工作区目录 |
| `agents[].sessionId` | — | 确切身份：首次使用会创建，重新挂载会恢复已物化的历史 |
| `agents[].resumeSessionId` | — | 加载这个已持久化的会话而不是新建；与 `sessionId` 互斥 |

生成的[配置目录](../../../docs/config-catalog.md#deepseek-aidsh-agent-loop)列出了每个可接受字段。`maxParallelToolCalls` 仍是易变的、默认为 `10` 的正整数 Config 字段；`1` 表示串行执行。循环把当前值传给每个批次的 `execute()` 调用，优先于执行器配置。实时编辑会应用到下一个批次；`agents` 仍是启动配置。

配置式恢复会在发布之前把声明的路由记录为 Session 选择。编程式恢复会保留 Session 选择，除非其 setup 显式记录了另一路由；仅靠初始 `agentOptions` 不会覆盖已保存的历史。

### 以编程方式创建或恢复 agent

插件和宿主通过 `ctx.agents.create()` 创建 agent，通过 `ctx.agents.resume()` 恢复已持久化的会话；二者都返回一个 `AgentHandle`，其 `dispose()` 拥有确切的拆卸。循环会把每个创建的 agent 运行到完成——只有当调用方必须自己拆除 agent 时才需要该句柄。

```text
const handle = await ctx.agents.create({
  sessionId,
  agentOptions: { provider: 'deepseek', model: 'deepseek-chat' },
  setup: (agentCtx, agent) => { /* scoped registrations plus explicit unpublished Agent */ },
})
```

每次收件箱变更都会提交一个规范化后的 `agent/inbox/spliced` 事件。投影注册表会同步折叠该事件，因此当 `Session.append()` 返回时，活动投影已经反映了该 splice。插入、编辑、移除、认领和取消都通过同一套标准 splice 坐标重放。普通移除携带 `outcome: 'canceled'` 并发出 `agent/inbox/discarded { message }`；认领使用不带 outcome 的纯删除，并发出 `agent/inbox/claimed`。每次插入都发出 `agent/inbox/inserted { message }`。`MessageId` 在两个待处理列表之间保持唯一。需要已移除消息的消费者应使用认领或丢弃通知，而不是依赖 splice 之前的 `session/event` 视图。

### 一个步骤做什么

每个步骤发送会话的派生历史——最新的非空 `system/message` 节点作为生效提示词，若渲染后的提示词为空则不发送任何系统消息——以及其可见工具 schema；模型的工具调用会经过受保护的工具体流水线，每个被接受的事实都会在下个步骤从中派生之前追加到会话日志。循环把完整的原始调用批次传给 `ctx.tools.execute()`；内置执行器保留模型顺序的结果和互斥屏障。取消是协作式的：`agent.cancel()` 中止当前活动，并且（除非设置了 `keepInbox`）清空待处理工作；被取消的流会为已经交付给用户的文本定稿。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释本包如何实现上述行为；可观察的契约在[使用本包](#use-this-package)中说明。

### 设计概念

本包是公共 `Agent` 契约的唯一具体实现。它把自己注册为 `ctx.agents` 上的 `AgentFactory`，因此消费者从不需要导入本包；每个被创建 agent 的所有权属于调用方 fiber 和循环提供者，并汇合到一个记忆化的静默边界。每个可观察的效果都通过会话事件和 `agent/*` 分类法发生——包的内部实现永远不是公共表面的一部分。

### 请求头与适配器默认值

在提示词组装之前，循环调用 `agent.model.current()`，并为该步骤及其重试捕获 provider、model 和可选的显式推理强度。`AssembleContext.modelSelection` 和 `agent/pre-step.modelSelection` 携带该选择；提示变量使用其路由，省略的 effort 使用适配器默认值。已弃用的 `agent/request` 钩子仍可供现有监听器使用，并可替换采样等其他控制项。更改 provider 或 model，或者添加、更改、清除推理强度，都会在输入被提交之前拒绝该步骤。稍后记录的选择会应用到下一个步骤，包括同一轮次中的工具续接。

在 `agent/request` 之后，`ctx.llm.prepareCall()` 校验适配器拥有的字段，并在活跃的轮次 signal 下解析推理强度和输出 token 默认值。循环在解析、`request/header` 记录和派发过程中保留那个确切的适配器。首次请求会写入完整头部；信封变化（配置或工具——提示词不属于头部）、显式的消息序列起点、表面替换或图像卸载决策之后的请求，以及恢复，也都会写入头部；未变化的步骤、重试以及同一序列中后续的普通轮次会继承最新头部，而历史内的提示词追加不算替换，因此其后的请求也会继承头部。除头部外，循环仅在 provider、model、`contextWindow` 或来自 `prepareCall()` 的路由 `systemPromptUpdate` 模式中有一项与最新快照不同时记录 `request/context`。在下一个瀑布流之前，循环会移除适配器默认字段，以便当前路由重新解析它们，而显式设置继续保留。未处理的路由仍会以 `NO_ADAPTER` 失败。

循环会在首次请求时深度冻结每条派生消息的身份，并仅在同一 agent 内复用该证明。恢复的消息保留其身份；请求构造不会冻结其包含的事件包装器。每次请求都会冻结其本地规范头部、新的消息数组和信封，同时让取消 signal 保持活动。[已归档的请求冻结决策](../../../.agents/notes/archived/simplification/2026-09-06-agent-request-freeze-evidence.md)解释了所有权和测量方式。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`AgentLoop` 服务、配置 schema、声明式 agent 启动、工厂注册 |
| [`src/agent.ts`](src/agent.ts) | 具体的 `ReactLoopAgent` 驱动：收件箱、轮次/步骤状态机、取消 |
| [`src/inbox.ts`](src/inbox.ts) | 包内部 `ReactLoopInbox`：持久投影、结构化命令和仅循环使用的认领状态 |
| [`src/runtime-context.ts`](src/runtime-context.ts) | 每步骤运行时上下文快照的处理 |

### 创建与拆卸

全新创建和恢复共享同一套受回滚覆盖的初始化：围绕已获取的 Session 构造具体 agent 和作用域上下文；存储构造函数历史、进入 SessionStore 并完成 `session/created`；等待可选的 setup 及其提交；进入 AgentRegistry；等待串行的 `agent/created` 监听器；然后释放排队的输入。创建运行时子节点的调用方会设置 `options.parentAgent`；调用方 Context 单独拥有事务和活动句柄。setup、提交或监听器失败以及所有者释放都会回滚已准备的资源。Session 在 setup 期间可写，每次移除都会发出 `session/disposed`，包括在 Agent 创建公告之前发生的 setup 失败。初始化失败会保留已恢复的收件箱输入和任何已存储的事件；它只会在释放其作用域和已获取的写句柄之后才拒绝。在持久化仍在创建写句柄时取消可能更早拒绝；该句柄会在创建结算时关闭。已交付的公告仍可观察，并会收到匹配的释放通知。拆卸会停止并排空驱动、回卷作用域、关闭会话的写路径、分离 agent，然后分离会话。每次分离都绑定到确切进入的对象，因此过期的 disposer 无法移除后来同 id 的替代者。

循环在发布工厂之前等待其必需的注册。它在模型选择和收件箱句柄上调用 `readerFor(session)`，并把回调作为单个强类型对象传给驱动；模型和收件箱协作者分别接收各自的回调。工厂卸载期间，全局注册可能在拆卸完成之前消失；保留下来的句柄在作用域清理期间仍可读取，包括来自作用域中止监听器的取消。调用方卸载、工厂卸载和句柄释放都会等待同一次拆卸。

### 持久化集成

循环是会话写句柄的生产级获取点。当挂载了 `ctx.sessionPersistence` 时，`create`/`createAgent` 调用 `persistence.create(header)`——在发布之前存储持久身份并取得写所有权——并通过句柄追加构造函数种子；`resume` 先调用 `persistence.open(id, 'write')`（排除同一 id 的并发恢复），通过句柄读取物理上有效的日志，并为在轮次中途崩溃的日志以普通批次追加 `interruptedTurnClosers`——语义上的崩溃修复是 agent 层的职责，而不是存储入口的职责。在进入存储之前，`appendUnstoredSuffix` 存储构造函数历史，包括种子标记。随后 setup 通过活动事件流追加。从进入存储开始，已挂载的后端会按会话 id 把该会话的 `session/event` 批次、`session/flush` 屏障和 `session/disposed` 退役路由到活跃的写句柄；循环只通过它拥有的句柄接触存储。后端仍挂载时，拆卸会在驱动提交其关闭事件之后关闭句柄；关闭会排空已路由的缓冲区并释放写所有权。没有后端时，会话仅存在于内存中，其他一切不变。

### 轮次与步骤流程

驱动在其生命周期内拥有一个 agent，并在 `ctx.agents.withInitiator(agent, ...)` 内运行。`AgentLoop` 在其服务生命周期内注册标准的 `inbox` 投影，因此在任何 Agent 存在之前以及所有 Agent 卸载之后，冷读取都能工作。它还拥有 `modelSelection`，并为每个 Agent 构造一个 `AgentModel`，使用公共的 [Model API](../agent/README.md#model-selection)。其包内部的 `ReactLoopInbox` 使用该共享投影处理结构化命令和仅循环使用的认领。在轮次边界，它会打开持久轮次，然后原子地认领待处理的下一步输入加上一个排队提示词；在步骤之间，它只认领下一步输入。驱动组装提示词和工具并运行 `agent/pre-step`；兜底逻辑在监听器运行之后投影运行时上下文。被拒绝的决策或空的首批次不会打开步骤。在接受之后的第一次尝试中，`step/start` 先于 `agent/request` 瀑布流和 `prepareCall()`；两个异步阶段都看不到待处理的系统提示词或被接受用户已提交到历史，任一阶段中的取消都不会提交任何内容。对于每次尝试，循环随后会使用准备好的调用能力，同步地对照存活的 `system/message` 节点协调渲染后的提示词，刷新已注册的运行时事实而不重新组装已绑定的提示词或工具，仅在第一次尝试时追加被接受的 `user/message` 批次，并就地替换其拥有的上下文候选，恢复被移除的运行时上下文，按需记录头部和上下文，并在通过该绑定的已准备调用流式传输之前派生并冻结请求。重试会复用同一渲染后的组装，而不会重复组装、`agent/pre-step` 或用户准入。协调会看到 pre-step 和重试压缩；断裂的序列会在头部整合提示词，而不是在已提交用户之后追加更新。请求由 `header.config`、`deriveMessages()` 和 `header.tools` 组成；它不携带 `system` 字段。每次模型尝试发出一个进程本地的 `start`，仅在匹配的持久 assistant 帧结算之后发出每个 `chunk`，并恰好发出一个终止 `end`；最终组装或消息追加失败会把它结算为 `aborted`，而 `committed` 跟随持久的 `assistant/message`。每次成功的模型调用追加一个消息锚点，被取消的流追加一个带已交付前缀的 `interrupted: true` 锚点，使下一次请求包含用户看到的内容。在一个步骤内，互斥调用形成屏障，并行安全的调用使用有界滚动池；策略、持久结果……（该行在 2000 字符处被截断）

提示词准入使用实际的 `prepareCall()` 结果，而不是前面的 `request/context`。没有系统节点时，即使提示词为空也会追加（保留节点 0 但不发送线上消息）。在无能力的路由上，或在生效文本不同的新请求序列处，非空渲染会在第一个系统节点处整合：每个非空的后续系统节点都会收到一条已记录的逐节点空替换，然后按需重写头部。休眠的空尾部不需要替换，也不决定生效文本。序列起点若最新的存活节点已经持有该渲染，则不产生系统事件，因此请求保持其原有前缀。在持续的 `in-history` 序列上，未变化的生效提示词不产生事件，而非空变化会追加。空渲染会通过已记录的逐节点空替换清空每个非空的后续系统节点，然后按需清空头部，无论路由或序列状态如何。不再有更早的指令对模型可见。没有活跃后续系统节点的空头部意味着没有提示词；重复清空和恢复会让它保持为空。恢复的非空提示词遵循同样的路由/序列规则：持续的无能力路由可以追加它，而无能力的路由或生效文本不同的新序列会重新填充头部。当 pre-step 决策声明 `startsRequestSeries`，或自附加或上次请求以来 `session.surface.contentGeneration` 发生变化（替换或图像卸载决策）时，步骤会开启一个序列。可见工具 schema 变化仅在准备好的路由缺少 `toolUpdate` 时强制提示词整合。同时支持工具和系统提示词更新的路由可以追加变化的提示词并激活新增工具，而无需重写更早的消息。如果另一个准入条件替换了系统节点，请求会带着当前工具声明开启新序列。仅恢复以及 provider 或 model 切换会继续该序列；准备好的路由仍支配准入。逐节点空替换会保留中间历史，而无需表面删除操作。

### 失败与取消

`turn/end` 声明 `TurnEndCancelCause`；取消会在那里记录一个新的 `AgentCancelCause`，保留调用方的 `kind` 和钩子的 `reason` 文本。活动的 `AbortSignal.reason` 仍是调用方的对象，传输层可以扩展它——Node 的 fetch 会在其上分配 `stack`——因此副本会让该堆栈信息不进入日志，并保持结束事件可追加。

最终适配器选择、派发和迭代失败会作为终止完成到达并进入 `agent/request-error`；处理中的监听器返回 `{ kind: 'retry' }` 而不调用 `next()`，而未处理的失败是终止性的。中间件、结果处理、工具和其他扩展失败仍会抛出并直接结束轮次——插件失败结束轮次，而不是循环。取消后未派发的模型工具调用会收到合成的 `tool/call` 加 `ABORTED_BEFORE_DISPATCH` 结果对。

在关闭失败的步骤之前，驱动会为每个未应答的 assistant 工具调用记录一个错误结果。已记录 `tool/call` 但没有已提交结果的会收到 `TOOL_OUTCOME_UNKNOWN`；没有调用记录的请求会收到 `TOOL_NOT_STARTED`。已提交的结果保持原样，已开始的派发会在恢复之前结算，轮次保留原始失败。这些结果让后续请求能够使用配对的工具历史，而不会自动重试不确定的操作。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

对大多数消费者来说，包级契约已经足够；当你需要周边领域和设计理由时，再阅读以下内容。

- [agent 包](../agent/README.md) —— 本循环实现的 `Agent` 句柄、注册表和 `agent/*` 事件。
- [核心子系统](../../../docs/subsystems/core.md) —— 轮次流程和拦截决策。
- [会话子系统](../../../docs/subsystems/session.md) —— 循环写入并从中派生的持久日志。
- [工具子系统](../../../docs/subsystems/tools.md) —— 循环派发所经过的流水线。
- [核心组地图](../README.md) —— 核心各包如何组合。

-----

<a id="model-experience"></a>
## 模型体验

### 完整的对话请求

#### 模型看到什么

对于每个步骤，循环发送会话的派生消息和可见工具 schema。非空的 `system/message` 节点携带提示词，其中最新的为生效版本；空渲染会从派生历史中清除所有提示词版本。它提供 `provider` 和 `model` 变量值，但不提供其他固定的说明文字。工作目录服务把活动目录作为用户上下文贡献。请求头始终记录活动工具。把它们的名称与前一个头部比较，会为新增和移除各发出一条 `developer/message`，这与模型能力无关；新增项引用新的头部。请求还携带 `Session.toolHistory()`，供 LLM 运行时构造 provider 声明。

#### Token 影响

系统文本和 schema 会在每个步骤再次付费，而在 `in-history` 路由上，每个保留的提示词版本都会持续付费，直到压缩遮蔽它或提示词协调清空它。按 agent 的作用域选择贡献，而权威的组装瀑布流可以改变最终请求，并使其监听器负责协议一致性。

#### KV 缓存影响

前缀复用要求更早的消息和声明在相同 provider 和 model 路由下保持字节一致。未变化的渲染会保留缓存前缀：有能力的路由即使开启新序列也会保留 in-history 系统节点，只有无能力的路由，或生效文本不同的序列起点，才会整合它们。就地替换系统节点的提示词变更会使请求从该节点的第一个 token 起不同——当该节点是节点 0 时则是整体不同——因此 provider 前缀缓存会从那里开始未命中；当已准备好的调用声明 `systemPromptUpdate: 'in-history'` 时，持续请求序列内的非空提示词变更会追加在缓存历史之后，因此穿过该历史的前缀仍可复用。更改保留的工具定义或重建声明会从第一个改变的请求 token 起使复用失效。

### 保留的消息历史

#### 模型看到什么

被接受的用户消息、assistant 消息、工具调用和结果、注入的上下文以及引导都会被记录，并在后续步骤发送。原始流 chunk、生命周期边界和其他仅日志事件被排除。

#### Token 影响

输入会随着每条表面消息增长，直到压缩替换遮蔽更早的节点；多步骤的工具轮次会在每个步骤重新发送累积的历史。

#### KV 缓存影响

普通历史增长是仅追加的，并保留可复用条目。表面替换或压缩会从第一个被遮蔽的历史 token 起使复用失效。

### 取消后未派发的调用

#### 模型看到什么

如果后续请求重放一个被中止的步骤，每个因取消而未能派发的工具调用都会带有错误码 `ABORTED_BEFORE_DISPATCH` 和结果文本 `Error: tool call aborted before dispatch`。

#### Token 影响

每个被跳过的调用都会在历史中留下一个固定的错误结果，直到压缩遮蔽它。

#### KV 缓存影响

仅追加；每个合成结果都跟在可复用的请求前缀之后，不会使已有的 KV 缓存条目失效。

### 步骤失败后未应答的调用

#### 模型看到什么

每个未应答的工具调用都会在后续历史中收到一个错误结果。对于已记录的调用，结果会说明 `Its outcome is unknown.`，并且只允许对只读或幂等操作进行重试；可能有副作用的操作需要先检查外部状态或询问用户。没有开始记录的调用会说明 `The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.`

#### Token 影响

每个未应答的调用都会在历史中留下一个恢复结果，直到压缩遮蔽它。

#### KV 缓存影响

恢复结果追加在既有历史之后，并保留其可复用前缀。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了循环何时需要特别留意。它们是当前包的约束，不是任务积压。

- **分类是一元的** —— 安全性取决于比较同级或资源的调用必须保持互斥（[理由](../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md)）。
- **根关闭持久化** —— 在仍有活动 Agent 时关闭根上下文，可能使其最终的 `turn/end` 留在内存中而未进入持久日志。Agent 拆卸完成并不保证该事件已被保存。
- **此前已关闭的不一致历史** —— 失败步骤恢复不会重写已经关闭的历史轮次中未应答的调用。
- **配置标签默认是新生成的** —— 省略 `sessionId` 会在每次启动时创建新的 `${id}-session-<uuid>`；确切的恢复或创建行为需要显式且稳定的 `sessionId`，而 `resumeSessionId` 需要已存在的持久历史。
- **配置式 agent 没有逐 agent 的人设字段或 setup 钩子** —— 它们使用部署人设；作用域人设和工具组合只能通过编程式 `ctx.agents.create()` / `resume()` 的工厂选项获得。
- **没有内置轮次预算** —— 工具调用或引导会继续当前轮次；限制失控轮次的策略必须从现有生命周期扩展点（例如 `agent/turn-stopping`）取消。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

无。

</details>

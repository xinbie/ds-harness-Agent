---
description: "面向插件、UI 和编排器的 Agent 句柄、活动注册表、进程本地的发起者作用域，以及 agent/* 事件词汇，用于构建或扩展 agent。"
kind: "package-reference"
---

# @deepseek-ai/dsh-agent

中文

## 概述

使用 `dsh-agent` 创建或恢复活动 agent、发送后续或引导输入、注入面向模型的上下文、取消工作，并等待空闲完成。插件、UI、钩子和编排器还可以观察或拦截 agent 活动，并把能力应用到单个 agent 而不影响其他 agent。当代码需要通过公共 `Agent` API 控制或扩展活动 agent 时选用它。把它与 `dsh-agent-loop` 之类的 agent 驱动配合使用；本包本身不会发起模型请求。发起者归属是进程本地的，必须在 worker、进程、持久队列和重启之间显式携带。

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

将 `dsh-agent` 与 `dsh-session-projection` 一起挂载：它提供 `ctx.agents`、`Agent` 句柄，以及用于获取已记录轮次和步骤位置的 `turnBoundaryOf(session)`。创建或恢复 Agent 还需要一个驱动来注册工厂；随附的驱动是 `dsh-agent-loop`。[会话模型选择](#model-selection)在每个句柄上以 `agent.model` 的形式提供。

### 创建或恢复 agent

`ctx.agents.create()` 在同一个身份下构建全新的 agent 和会话；`ctx.agents.resume()` 加载已持久化的会话并在其上重建 agent。二者都委托给已注册的工厂，并返回一个 `AgentHandle`——唯一能够拆除该 agent 的对象。发布和失败清理的时机见 [`AgentFactory`](src/index.ts)。在任一操作选项中设置 `parentAgent` 可使结果成为运行时子节点；省略则成为运行时根。`get(id)`、`list()` 和 `roots()` 查找活动 agent，`isOwnedBy(id, parent)` 测试确切的活动关系。

```text
const handle = await ctx.agents.create({
  sessionId,
  agentOptions: { provider: 'deepseek', model: 'deepseek-chat' },
})
// later:
await handle.dispose()   // stops the loop, unregisters, removes the session, unwinds the scope
```

`AgentOptions` 提供初始 provider/model 路由、可选的由适配器拥有的 `reasoningEffort`，以及可选的、为正数的 `maxTokens` 输出上限。循环会校验具体模型是否支持推理强度、解析适配器默认值、把生效值记录进请求头，并将它们应用到每次对话请求。可选的 `setup(agentCtx, agent)` 回调在 agent 发布之前组合其作用域世界：`agentCtx` 拥有注册，而显式传入的未发布 Agent 提供其 Session；该 Context 没有反向的 Agent 属性。作用域工具、提示片段和监听器在 `agent/created` 之前就已存在。Setup 仅用于组合：只在创建完成后驱动 agent。Session 在 setup 之前已进入其存储并完成 `session/created`，因此初始化事件会跟随活动事件流。

<a id="model-selection"></a>
### 选择模型

`agent.model` 实现 `Model`，与 `agent.inbox` 并列。`current()` 返回一个分离的选择：先取待定选择，再取最近一次请求的选择，最后取活动的 `agent.options`；当没有来源同时提供 provider 和 model 时返回 `undefined`。读取不会固定选择，也不会改变已准备好的步骤。

`select({ provider, model, reasoningEffort? })` 为下一个尚未开始准备的步骤分配完整选择。省略 effort 时使用适配器默认值；选择既不会继承旧的 effort，也不会查询默认值。与已记录选择相等的选择是无操作，但仅与初始选项相等的选择会被记录为 `model/selection`。调用方负责校验可用性和能力；追加失败会保留 Session 既有的保证。

普通恢复会保留已记录的选择。显式覆盖模型的入口会先构建完整选择，仅当配置路由未变且省略 effort 时才保留先前显式的 effort，然后调用 `select()`。Web 和 ACP 的用户选择直接调用 `select()`，因此省略 effort 意味着 Auto。选择会话模型不会改变部署默认值。

对于作用域切换通知，在 Agent setup 期间从 `dsh-agent` 调用 `installModelSelection(agentCtx)`。作用域拥有该监听器，并在释放时移除它。

### 驱动 agent 的对话

句柄的方法把已标识的用户角色消息送入 agent 的收件箱。`followup()` 将普通的下一轮提示词排入队列并唤醒驱动；`steer()` 提交下一步输入并唤醒驱动；`inject()` 添加面向模型的上下文而不唤醒驱动，因此它会落入下一个被准入的步骤。`cancel(cause)` 中止活动并（除非设置了 `keepInbox`）清空待处理工作；`whenIdle()` 在整个 agent 达到静默后解析。

```text
handle.agent.followup({
  content: [{ type: 'text', text: 'Summarize this workspace.' }],
  source: { kind: 'user' },
})
handle.agent.steer({
  content: [{ type: 'text', text: 'Focus on the tests.' }],
  source: { kind: 'my-plugin' },
})
await handle.agent.whenIdle()
```

### 将注册限定到单个 agent

`Agent.ctx` 是 agent 的作用域上下文：通过它建立的注册（工具、提示片段、变量、事件监听器、限制）只作用于该 agent，并在释放时回卷。agent 预设正是用同一机制为某个会话提供不同的能力集，而不影响相邻会话。

### 拦截或观察进行中的工作

`agent/request` 已弃用，仅为现有监听器保留。不要新增监听器。Provider、model 和可选的显式推理强度在步骤准备时固定；监听器必须保留这三者，包括缺席的 effort。`AgentOptions.maxTokens` 设置输出上限。其他每次请求的控制覆盖没有替代 API。受影响的调用方请参见[迁移指南](../../../docs/upgrade-guide/v0.2.1-alpha.4/session-model-selection/guide.md)。

`agent/*` 事件让插件无需依赖循环包就能对活动工作采取行动。`agent/pre-step` 可以拒绝提议的步骤，或替换进入该步骤的消息；`agent/request-error` 让监听器重试失败的模型请求；`agent/turn-stopping` 在原本已完成的轮次关闭之前运行，并可以通过引导保持其打开。`agent/assistant-stream` 携带一次进程本地 Assistant 尝试的有序 start、瞬时 chunk 和 end 帧。Start 命名该尝试的轮次和步骤，chunk 索引从零开始密集递增，`end.index` 是下一个 chunk 位置。循环会在已提交的 end 帧之前，把完整的紧凑流作为一条 `assistant/message` 或 `assistant/attempt` 提交，因此活动事件仍是展示数据，而不是重放来源。`agent/status`、`agent/created` 和 `agent/disposed` 驱动 UI 与协调状态，逐消息的 `agent/inbox/*` 通知让收件箱投影保持同步。确切的签名、派发模式和载荷契约位于[核心子系统页面](../../../docs/subsystems/core.md#cordis-surface)的生成区域。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释本包如何实现上述行为；可观察的契约在[使用本包](#use-this-package)中说明。

### 设计概念

本包建立在一个分离之上：公共 `Agent` 表面和注册表位于此处，而构造与驱动位于循环包中，通过已注册的工厂接入。因此消费者依赖的是 `dsh-agent`，而从不依赖 `dsh-agent-loop`，从而保持驱动可替换。第二个理念是发起者作用域：一条 `AsyncLocalStorage` 链，把确切的活动 `Agent` 贯穿其启动的异步驱动工作，使驱动之下的辅助函数无需在每次调用中转发 agent 就能归属其工作。

### 步骤准入

`PreStepDecision` 要么是 `{ kind: 'reject' }`，要么是 `{ kind: 'enter', messages, startsRequestSeries? }`。enter 分支包含完整、已标识、已冻结的消息批次。接受并不会提交它：在组装和 `step/start` 之后，已弃用的 `agent/request` 钩子在不改变步骤模型选择的情况下调整控制项，而 `prepareCall()` 在循环提交系统提示词和用户批次之前绑定适配器。任一异步阶段中的取消都不会提交任何内容。`startsRequestSeries: true` 声明一个独立的模型消息序列；包装监听器会保留该声明和批次，除非它有意替换其中之一。认领会从收件箱中移除所提供的消息，而认领之后插入的消息仍会为后续边界保持待处理。

### 持久收件箱

`Agent.inbox` 只暴露结构化的 `Inbox` 接口，投影词汇保留在本包中。dsh-agent-loop 拥有包内部的 `ReactLoopInbox` 和标准的 `inbox` 投影；循环服务为持久化的 `agent/inbox/spliced` 折叠获取一个注册，并为每个收件箱提供状态读取回调。注册表仍是活动 `{ 'next-turn', 'next-step' }` 状态的唯一所有者。重建会拒绝不安全或越界的 splice 坐标，以及在两个待处理列表之间重复的 `MessageId` 值，并报告出问题的事件 seq。

`Inbox` 暴露待处理的 `nextTurn` 和 `nextStep` 消息，并通过 `append`、`prepend`、`replace`、`remove`、`clear` 和 `splice` 修改它们。普通移除和 `clear()` 是持久取消。在步骤边界，循环的内部实现通过纯删除 splice 认领待处理输入。活动通知有意保持逐消息且最小化：`agent/inbox/inserted { message }`、`agent/inbox/claimed { message, turn }` 和 `agent/inbox/discarded { message }`。

### 持久模型选择

`Model` 和 `modelSelection` 投影类型位于此处。默认驱动创建每个 `AgentModel`，并与其收件箱一起拥有投影注册。每个实例绑定 Session、活动选项和投影读取器；它不持有选择的第二份副本。循环在步骤准备之前捕获一个分离的选择，并在重试之间保留它。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`AgentRegistry`、工厂槽位、发起者作用域、`CreateAgentOptions`/`ResumeAgentOptions` |
| [`src/runtime-types.ts`](src/runtime-types.ts) | `Agent`、结构化的 `Inbox`、`AgentStatus` 以及 `agent/*` 事件声明 |
| [`src/types.ts`](src/types.ts) | `AgentOptions`、取消原因和收件箱投影词汇 |
| [`src/dispatch.ts`](src/dispatch.ts) | `agentEvents` 融合派发器和 `assembleContextFor(agent)` |
| [`src/model-selection.ts`](src/model-selection.ts) | `AgentModel`、其持久投影以及 `installModelSelection` 切换通知 |
| [`src/consumed-work.ts`](src/consumed-work.ts) | `foldConsumedWork(events)`：日志中已消费的工作变成了什么 |
| [`src/archive-admission.ts`](src/archive-admission.ts) | Workspace 注册表归档准入的 `turn` 族：一个运行中的轮次及其用户原因取消 |

### 注册表与生命周期

`AgentRegistry` 为每个活动 agent 保留一条包含其载体和创建者关系的条目。等待 `register()` 以来源 `startup` 完成串行创建监听器之后，再使用已构造的 agent；异步工厂使用拆分后的 `enter()`/`announce()` 对，使 setup 和初始化保持在回滚覆盖之下。创建期间请求的分离会等待每个已等待的监听器结算，且每次分离都绑定到确切的条目，因此过期的 disposer 无法移除后来同 id 的替代者。拆卸会停止并排空循环、回卷作用域、分离 agent，然后分离会话；在私有清理之后，该 id 才可重新使用。

注册表还为其发布的每个 Agent 回答 Workspace 注册表的归档准入（[接缝](../../workspace/workspace/README.md)）：当 Session 的 Agent 正在运行时，`workspace/session-activity` 报告 `turn` 族，其中包括正在等待批准或回答的轮次；`workspace/session-stop` 会以用户自己的停止方式取消该轮次——即 `agent.cancel({ kind: 'user' })`，但不带停止按钮的 `keepInbox`，因此排队输入会随一次已记录的收件箱 splice 一同丢弃，而不会在之后唤醒已归档的 Session。不等待任何内容结算；没有活动 Agent 的 Session 不存在可运行的轮次。`turn` key 从 [`src/types.ts`](src/types.ts) 合并进 `SessionActivityKindMap`，因此渲染这些族的 Client 需要为它导入 `@deepseek-ai/dsh-agent/types`。

### 发起者作用域

每个驱动都在 `ctx.agents.withInitiator(agent, ...)` 内运行其完整生命周期，因此继承的异步链能观察到该 agent；`withoutInitiator()` 会为共享定时器等无关的进程本地工作隐藏它。该边界仅是进程本地的归属——环境中的存在既不是存活证明，也不是授权，显式身份在 worker、进程、持久化和线上边界处仍然具有权威性。拆卸会拒绝新的边界，让已返回 Promise 的边界排空，然后禁用底层存储。[发起者作用域决策](../../../.agents/notes/implemented/architecture/2026-07-15-agent-initiator-scope.md)拥有详细契约。

### 所有权不变量

`AgentHandle` 的 disposer 是一种能力：在消费者之中，只有其持有者可以拆除 agent。已注册的工厂提供者是结构性的共同所有者，因为作用域 agent 依赖该提供者的服务 API；提供者卸载会停止并排空它创建的每个活动句柄。`ctx.agents.get(id)` 仍返回裸 `Agent`——句柄只暴露给创建它的消费者。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

对大多数消费者来说，包级契约已经足够；当你需要周边领域和设计理由时，再阅读以下内容。

- [核心子系统](../../../docs/subsystems/core.md) —— 循环地图、`Agent` 句柄、拦截决策以及生成的服务 API。
- [agent-loop 包](../agent-loop/README.md) —— 创建、驱动和释放 agent 的默认驱动。
- [会话子系统](../../../docs/subsystems/session.md) —— 句柄背后的持久日志和派生历史。
- [发起者作用域 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-15-agent-initiator-scope.md) —— 边界与拆卸契约。
- [核心组地图](../README.md) —— 核心各包如何组合。

-----

<a id="model-experience"></a>
## 模型体验

### 用户消息、引导消息和注入消息

#### 模型看到什么

`followup`、`steer` 和 `inject` 把已标识的用户角色消息送入所属会话；被接受的内容会成为派生历史的一部分，供模型在后续步骤读取。`agent/pre-step` 和其他已声明事件让插件拒绝提议的步骤或添加持久请求材料。可选的作用域模型切换监听器会追加下文所述的通知。

#### Token 影响

被接受的内容会成为保留历史或重复的会话前缀；被阻止的内容不贡献任何请求 token。大小取决于调用方和插件。

#### KV 缓存影响

被接受的历史和引导是仅追加的；被阻止的提交不发送请求。会话前缀在其循环实例内保持稳定，而新的或恢复的实例可能建立不同的前缀。

### Agent 作用域的请求组合

#### 模型看到什么

通过 `agent.ctx` 的注册可以遮蔽提示片段或工具，并可在未发布 setup 期间安装仅限该 agent 的拦截器，因此一个 agent 看到的提示词和工具集与相邻 agent 不同。模型选择在提示词组装之前捕获一个 provider/model/effort 值，并将它应用到同一步骤的请求和重试；稍后并发发生的变更会等到另一个步骤。

#### Token 影响

作用域贡献只影响该 agent，并在释放时消失。

#### KV 缓存影响

改变提示片段、工具定义或请求监听器的 setup 或重载，可能从第一个受影响的请求 token 起使复用失效。

### 可选的模型切换通知

#### 模型看到什么

当被接受步骤的固定路由不同于上一次请求时，作用域监听器会追加 `[model changed: assistant turns above this point were generated by <previous>; the session continues with <next>]`。只有跨 provider 切换时标签才包含 provider。初始请求、仅 effort 的变更、被拒绝的步骤以及空的“无请求”决策都不添加任何内容。头部持久化之前的失败会导致下一个请求步骤重复该通知。

#### Token 影响

每个被准入的通知都会增加保留的用户消息文本；选择事件本身不添加提示词文本。

#### KV 缓存影响

通知会追加，而不替换更早的历史。切换模型可能阻止复用前一个模型的缓存；缓存可用性由 provider 拥有。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了本包何时需要特别留意。它们是当前包的约束，不是任务积压。

- **发起者作用域是进程本地的** —— worker、子进程、HTTP、持久队列和重启必须显式物化任何所需的身份。
- **环境身份可能比存活状态活得更久** —— 消费者在进行生命周期敏感的工作之前，仍应检查 `agent.status`、取消情况和拥有能力契约。
- **创建监听器共享初始化生命周期。** `agent/created` 监听器不得等待 `agent.whenIdle()` 或自己所有者的释放：这些操作会等待创建完成。只在所需的异步工具和提示词安装完成后才返回。
- **`cancel()` 默认清空收件箱** —— 它会中止进行中的轮次以及排队和引导工作；`cancel(cause, { keepInbox: true })` 只中止该轮次并保留待处理项，且不存在仅中止步骤而保持轮次运行的机制。
- **每条额外的 `UserMessage` 恰好携带一个 `MessageSource`** —— 来自多个插件并合并到一条消息上的贡献只归到一个来源下，因此该消息无法命名多个生产者。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

本开发备注是维护者的工作背景，明确不具权威性。未决定的方向：委派之外的 agent 间通道——共享状态、流式子输出以及后台或轮询语义仍不在当前委派接缝之内；`SessionStartSource` 的取值 `'clear'`/`'compact'` 已保留但尚无发出者，等待驱动子系统。

</details>

---
description: "面向工具作者与维护者的工具注册表和执行流水线，用于注册、限制、展示或调试面向模型的工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tools

中文

## 概述

使用 `dsh-tools` 向模型暴露强类型能力、校验调用、执行允许/拒绝/询问策略，并在普通工具失败时不结束轮次而返回最终结果。挂载 native 或 PTC 执行器来选择模型交互与批次执行行为。工具作者使用 `defineTool` 声明带类型的参数与输出、协作式超时、并行安全性以及可选的 UI 展示信息。模型会看到每个被许可工具的声明名称、描述和参数 schema；按 agent 的限制可以收窄这一可见集合。

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

`ctx.tools.execute()` 接受一个完整的原始调用批次。独立服务调用时没有 `agent`；模型步骤之外的编程式调用（包括初始化钩子）没有 `log`。没有 `log` 的 Agent 仍会提供工具作用域，但不会产生根级 call/result 事件。

在任何 agent 调用工具的地方挂载 `dsh-tools`：它提供 `ctx.tools`，即每个工具插件注册、并由所选执行器解析的注册表。注册一个工具就足以使其可见——注册表会自动把它的 schema 送入系统提示词组装。

### 注册工具

`defineTool` 构建一个强类型工具定义：面向模型的名称、描述和参数 schema，一个规范输出声明，以及一个只返回所声明 JSON 值的 `execute` 函数体。模型参数在执行前会被校验；无效输入会成为普通的错误结果。

规范值属于执行层；Session 记录的是渲染后的内容和可选的展示元数据。替换或删改这些内容不会移除编程式调用者可获得的规范值；若策略必须拒绝该访问，它必须阻止执行或替换该值。

```ts
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

declare const ctx: Context

ctx.tools.register(defineTool({
  name: 'read_file',
  description: 'Read a file from disk.',
  parameters: {
    path: { type: 'string', required: true, description: 'Absolute file path' },
    offset: { type: 'number' },
    limit: { type: 'number' },
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args, exec) {
    // args is typed: { path: string; offset?: number; limit?: number }
    return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
  },
}))
```

统一的 schema DSL 支持 `string`、`number`、`integer`、`boolean`、`null`、`array`、`object`、仅作者可用的 `json`，以及恰好取其一的 `oneOf`；`InferValue` 在拓宽为 `JsonValue` 之前，能在最多 16 层容器中保持精确类型。原始 JSON Schema（`JsonSchemaNode`）是与子 agent、工作流和 MCP 共享的线上层对应物。

<a id="conditional-tools"></a>
### 条件工具

`register(definition, { when })` 针对每个模型步骤求值一次同步或异步条件。该条件接收 `{ agent, modelSelection, signal }`；`modelSelection` 是步骤准备阶段为步骤内每次请求尝试所捕获的 provider、model 和推理强度，与 `AssembleContext.modelSelection` 是同一个值。为假时，该工具会从执行器的描述、PTC 绑定和执行中省略。条件抛错会使步骤准备以 `TOOL_ACTIVATION_FAILED` 失败；这不会被当作普通的不可用处理。条件必须观察取消，且不得更改注册或执行工具工作。

`resolve({ agent, modelSelection, signal })` 返回一个由步骤拥有的 `ResolvedToolSet`。把它作为 `toolSet` 传给提示词组装和该步骤的 `ctx.tools.execute()` 批次，然后在批次结算后释放它；步骤内的重试会复用它。执行器会把该批次所用的集合应用于每一次调用，包括 PTC 程序子调用。注册仍由 effect 拥有；每次选择只准入其确切 agent 作用域中的原始注册。释放、新的限制或同名替换会阻止尚未开始的调用使用它；取消之后，调用会以共享流水线的取消结果结算。已开始的操作保留其协作式取消义务。没有已解析集合的批次中的条件调用会返回 `UNKNOWN_TOOL`。

`get(name, scope, toolSet)`、`definitions(scope, toolSet)` 和 `schemas(scope, toolSet)` 用于检查已准入的集合；省略 `toolSet` 时检查已注册定义而不求值条件。`executable(name, scope, toolSet)` 是执行查找：它会应用该集合，没有集合时则排除条件注册。执行器描述和片段接收与 `AssembleContext.toolSet` 相同的选择。展示转换不能添加或移除可调用工具。

### 选择执行器

在部署、预设或 Agent 作用域中挂载一个执行器。最近的作用域选择提供方；同一作用域中的重复提供方会失败。Native 直接暴露可见能力；PTC 暴露 `run_code` 和一个生成的 SDK。执行器的注册和释放不会触发 `tools/change`；提示词组装和批次在运行时解析当前执行器。

```yaml
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-tool-executor-native'
```

Agent 步骤的并发度使用 [agent-loop 配置](../agent-loop/README.md)。执行器设置见 [native](../tool-executor-native/README.md) 或 [PTC](../tool-executor-ptc/README.md) 包。自定义提供方只需实现 `describe(definitions)` 和 `execute(batch)`；共享流水线是可选的。注册表会分别为提示词描述和每个 `ctx.tools.execute()` 批次选择当前作用域的执行器。已接受的批次即使其提供方随后卸载，也会通过所选提供方结算；根据提供方的释放策略，结算可能包含取消错误。在注册替代者之前，新批次会被拒绝。

### 按 agent 限制工具

`ctx.tools.restrict(filter)` 对某个 agent 继承的全局工具应用允许或拒绝掩码；掩码会相交，作用域注册仍然可见，限制在释放时解除。`ctx.tools.get(name, scope)` 按某个作用域看到的样子解析工具。当 Host 本地的展示器消费者需要匹配实际执行的定义时，应传入调用方 agent。`ctx.tools.schemas(scope)` 返回可见的 schema，但不包含 `execute` 函数。

### 对调用执行策略

`ctx.tools.guard(guard)` 在可扩展的 `tools/pre-execute` 瀑布流之后注册一个单调的同步守卫：返回原因即拒绝该调用，之后任何监听器都无法把这一拒绝变回许可。流水线的事件给予插件更多控制——`tools/pre-execute` 决定允许/拒绝/询问，`tools/execute` 包装派发以处理超时或重试，`tools/post-execute` 检查或替换结果，`tools/result` 观察冻结的最终结果。

工具的 `projectContent` 会在 post-execute 策略之前安装执行阶段准备好的内容。策略仍可替换或阻止它；`finalizeContent` 是这些策略之后最终的内容转换。

### Host 展示描述符

工具可以保留纯粹的 `presentCall()` 和 `presentResult()` 方法，供 Host 本地的消费者使用。内置的 Web Client 不消费这些值。它通过 `tool.call.toolview` 选择渲染器，并从原始调用参数、结果内容、失败状态和持久化元数据推导卡片属性。[客户端派生展示决策](../../../.agents/notes/implemented/architecture/2026-08-23-client-derived-tool-presentation.md)拥有这一传输分离。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释本包如何实现上述行为；可观察的契约在[使用本包](#use-this-package)中说明。

### 设计概念

注册表在作用域层中持有强类型的 `ToolDefinition`，并在请求时把它们投影为面向模型的 `ToolSchema` 集合——`output`、`execute`、`finalizeContent`、`timeoutMs` 和展示回调永远不会泄漏到线上。内置执行器复用共享流水线：`tools/pre-execute`（可扩展的允许/拒绝/询问）→ 已注册的单调守卫 → `tools/execute`（围绕派发的包装器）→ `tools/post-execute`（检查/替换、附加上下文）→ 定义拥有的 `finalizeContent` → 只观察的 `tools/result` 事件。只有 `tools/execute` 视图可以替换必需的 signal，且注册表会在函数体之前重新融合调用方 signal。

### 源码地图

- [`src/index.ts`](src/index.ts) —— 插件入口和公开工具 API；作用域工具服务与执行器选择。
- [`src/contracts.ts`](src/contracts.ts) —— 工具定义、调用结果、守卫与决策。
- [`src/executor.ts`](src/executor.ts) —— 执行器描述和批次输入/输出。
- [`src/pipeline.ts`](src/pipeline.ts) —— 共享的 `prepare`、`dispatch`、`complete` 阶段及其结果类型，以及批次入口。
- [`src/batch.ts`](src/batch.ts) —— 并发、有序结果和可选的 Session 记录。
- [`src/events.ts`](src/events.ts) —— 共享的执行策略事件。
- [`src/schema.ts`](src/schema.ts) —— 强类型工具定义和面向模型的 schema 投影。
- [`src/json-schema.ts`](src/json-schema.ts) —— 受支持的 JSON Schema 校验。
- [`src/presentation.ts`](src/presentation.ts) —— 工具卡片渲染意图。

### 执行与取消

每次强类型调用都会物化并冻结解析后的参数，分配一个不透明的关联 token，并运行策略和派发。pre-execute 拒绝可以在其面向模型的原因旁附加 `ToolErrorInfo`；native 与 PTC 的持久投影会保留结构化的名称、代码和可选的面相用户的原因，而不会把该细节加入模型内容。取消是协作式且静默的：每个工具函数体都会收到调用方拥有的 `exec.signal`，且必须观察它；函数体调用之前的取消是 `ABORTED_BEFORE_DISPATCH`，调用之后则只把成功结果替换为 `ABORTED`。拒绝、包装器失败、工具失败、post 策略失败以及超时拥有的 `TOOL_TIMEOUT` 保持更具体。未知工具和抛错的工具会变成结构化错误（`UNKNOWN_TOOL`），因此调用失败但不会结束轮次。

### PTC 模式

[PTC 执行器](../tool-executor-ptc/README.md)拥有程序传输、SDK 生成、嵌套派发和图像上下文。

<a id="extension-points"></a>
### 扩展点

工具插件调用 `ctx.tools.register()`，其 schema 会自动流入提示词组装。`tools/pre-execute` 是可重排序的允许/拒绝/询问闸门；`ctx.tools.guard()` 在其后添加单调的拥有方策略；`tools/execute` 包装规范化后的规范派发，用于超时、重试或指标；`tools/post-execute` 可以替换内容或值、以反馈阻止，或附加有序上下文；`tools/result` 观察不可变的最终结果。MCP 服务器发现工具并使用服务器的 schema 注册它们。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

对大多数消费者来说，包级契约已经足够；当你需要周边领域时，再阅读以下内容。

- [工具子系统](../../../docs/subsystems/tools.md) —— 完整的流水线类型、schema DSL 和生成的服务 API。
- [生成的工具目录](../../../docs/tool-catalog.md#deepseek-aidsh-tool-executor-ptc) —— 模型收到的随附工具 schema。
- [工具执行流水线](../../../docs/tool-execution-pipeline.md) —— 流水线的可视化。
- [添加工具的指南](../../../docs/cookbook/adding-a-tool.md) —— 逐步编写工具。
- [工具测试套件](../../test-support/tool-testkit/README.md) —— 用于测试和基准的工具定义与执行夹具。
- [协作式取消 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-19-cooperative-tool-cancellation.md) —— 完整的取消契约。
- [核心组地图](../README.md) —— 核心各包如何组合。

-----

<a id="model-experience"></a>
## 模型体验

### 普通工具 schema

#### 模型看到什么

在普通模式下，模型会看到每个可见定义的确切名称、描述和 JSON Schema；随附的定义记录在生成的[工具目录](../../../docs/tool-catalog.md#deepseek-aidsh-tool-executor-ptc)中。Agent 作用域的限制、遮蔽和扩展注册会改变该 agent 的最终工具集合。

#### Token 影响

每请求的固定开销与可见定义的数量成正比。隐藏工具的限制会为该 agent 移除其全部 schema 开销。

#### KV 缓存影响

当可见定义及其顺序保持不变时，前缀保持稳定。注册、释放或作用域限制都可能从第一个变化的 schema token 起使复用失效。

### 工具调用历史与结果

#### 模型看到什么

循环会保留模型生成的参数和注册表的最终内容。任何抛错或被拒绝的调用都会恰好变成 `Error: <message>`；结构化的面向用户的失败细节不会加入该消息。PTC 模式会渲染外层程序打印的行和返回值，两者都为空时为 `(run_code completed with no output)`，或 `Error: code run failed (<kind>): <message>`，其后按条件跟 `Captured output:` 和捕获的行。内部派发事件只保留在日志中，而带图像的成功子结果会作为带来源归属的上下文追加到外层结果之后。

#### Token 影响

参数、结果和附加上下文取决于数据，并在压缩之前反复发送。隐藏工具的限制也会在模型能够调用它们之前移除其 schema。

#### KV 缓存影响

只追加；新可见的内容跟在可复用的请求前缀之后，不会使已有的 KV 缓存条目失效。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了注册表何时需要特别留意。它们是当前包的约束，不是任务积压。

- **并发策略不是事件闸门** —— `executionMode()` 直接读取已解析的工具定义；插件只能在自己拥有的定义上声明分类器。
- **`tools/pre-execute` 故意无法改写 `exec.arguments`** —— 记录和渲染的参数会与实际运行的内容不同步；改写设计是一份[提议中的 Agent Note](../../../.agents/notes/proposed/feature/2026-06-30-pre-tool-input-rewrite.md)。
- **调用方定义的子 agent 和工作流结构化输出仍以对象为根** —— 这是消费者层的防护；共享的 schema 词汇和工具输出支持任何 JSON 根。
- **定义上的 `timeoutMs` 仅是声明性的** —— 注册表从不强制截止时间；强制需要 `@deepseek-ai/dsh-tool-call-timeout-policy` 包装器。

`defineTool()`、注册表 schema 投影和系统提示词组装都会保留 `deferLoading: true`。该标记请求延迟加载定义，并不意味着产生 `tool-addition` 记录；[LLM 包](../../../packages/llm/llm/README.md#known-limitations-and-deferred-work)记录了提供方的强制执行限制。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

无。

</details>

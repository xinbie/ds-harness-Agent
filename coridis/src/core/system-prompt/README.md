---
description: "面向用户与维护者的系统提示词组装，用于添加提示片段、变量、工具 schema 来源，或配置面向模型的提示词。"
kind: "package-reference"
---

# @deepseek-ai/dsh-system-prompt

中文

## 概述

`dsh-system-prompt` 让 agent 在每个模型步骤都收到一份有序的系统提示词以及可用的工具 schema。用它来添加提示片段、动态运行时事实、可复用变量或工具 schema，或者控制固定的 Harness 身份、部署人设、运行时上下文和面向模型的工具顺序。Agent 作用域的贡献会覆盖同名的全局默认值，而不影响其他 agent。无效的完整提示词组合和未解析的变量会让组装失败，而不是发送格式错误的提示词。

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

在任何运行 agent 的地方挂载 `dsh-system-prompt`：它提供 `ctx.systemPrompt`，即所有提示词贡献所落入的注册表。贡献是有作用域的——通过 `agent.ctx` 注册只影响该 agent，并遮蔽同名的全局项。

<a id="configure-the-prompt"></a>
### 配置提示词

配置拥有固定的开头语、运行时上下文、部署人设的前缀与后缀以及工具顺序；其余一切来自注册的贡献。

```yaml
- name: '@deepseek-ai/dsh-system-prompt'
  config:
    includeHarnessIdentity: true
    includeRuntimeContext: true
    personaPrefix: 'You are the deployment assistant.'
    toolOrder: ['<unlisted-tools>']
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `includeHarnessIdentity` | `true` | 在 order −1000 处包含固定的第一方开头语 `You are an AI agent powered by DeepSeek Harness.`。仅当某个兼容性部署自己拥有完整的系统提示词时才设为 false。 |
| `includeRuntimeContext` | `true` | 在组装中包含可选的有序动态运行时上下文 |
| `personaPrefix` | `''` | order 为 `0` 的全局人设前缀模板，位于第一方指引之前 |
| `personaSuffix` | `''` | order 为 `10200` 的全局 `deployment:persona-suffix` 模板，位于第一方指引之后 |
| `toolOrder` | — | 显式的面向模型工具顺序，带且仅带一个 `'<unlisted-tools>'` 收尾项 |

生成的[配置目录](../../../docs/config-catalog.md#deepseek-aidsh-system-prompt)是每个可接受字段的详尽来源。`toolOrder` 列表若没有恰好一个收尾项或存在重复，会在加载时失败；列出了名称却没有注册相应工具的，会拒绝每一次 `assemble()`。

### 贡献提示片段

片段携带静态文本或由上下文解析的文本，并带一个 `order`；它们按升序拼接，order 相同时按名称的码元顺序。仓库自有的贡献者通过 `ctx.systemPrompt.getSectionOrder(name)` 解析集中分配的位置；运行时上下文贡献者使用 `getContextOrder(name)`。外部贡献可以使用任意有限 order。`complete: true` 的片段在组装后成为确切的完整提示词；若存在多个生效的完整片段，组装会失败。

```text
ctx.systemPrompt.section({
  name: 'tool:bash',
  order: 100,
  text: 'Prefer bash for file and process operations.',
})
```

在片段或动态上下文上设置 `interpolate: false` 可逐字保留其文本，包括生成的工具文档或目录名中的 `{{…}}` 组。其他贡献默认对变量进行插值。

`refreshContext(assembly, context)` 在 pre-step 和路由准备之后刷新已注册的运行时事实。它保留被接受的片段、工具、变量，以及仅由组装瀑布流贡献的上下文，应用当前的“可选上下文抑制”，并恢复缺失的必需条目。把会变化的事实放进上下文提供者；已注册的上下文文本会在准入前被重新读取。

agent 循环在提议每个步骤前（`agent/pre-step` 之前）调用一次 `assemble(context)`，并传入该步骤捕获的模型选择（`context.modelSelection`）和已准入的工具集（`context.toolSet`）。展示类监听器接收片段、上下文和变量；工具仍由提供方拥有。感知工具的片段回调使用 `context.toolSet` 来检查与执行相同的该步骤选择。

### 贡献提示变量

变量在片段或上下文文本中以 `{{name}}` 引用，并在每次组装时解析；作用域变量会为该 agent 遮蔽同名的全局变量。循环提供 `provider` 和 `model`；插件可以注册自己拥有的事实。工作目录服务以字面用户上下文的形式提供目录文本。

```text
ctx.systemPrompt.variable('response_language', () => 'English')
```

自定义人设模板不得依赖内置的 `{{cwd}}` 变量：循环不会注册它，所以未解析的引用会在任何模型请求之前导致提示词组装失败。请从 home、profile 或调用级 `personaSuffix` 设置以及预设的 `suffix` 字段中移除 `Your working directory is {{cwd}}.` 子句，同时保留无关文本。对原本为空的 suffix，请省略或清空它。[工作目录服务](../../session/working-directory/README.md)提供所需的当前目录上下文。

### 贡献工具 schema

工具 schema 提供者在每次组装时求值，并贡献模型可见的 `ToolSchema` 集合；`ToolRuntime` 会自动注册自身，因此大多数工具无需在这里手工接线。提供者返回限制之后可见的集合，以及供 `toolOrder` 使用的限制之前的名称全集。

### 抑制运行时上下文

`suppressRuntimeContext()` 为调用作用域移除可选的动态上下文，而不禁用拥有它们的服务。标记为 `required` 的贡献仍然可见。多个抑制器会叠加；当不再有抑制器时，可选上下文会恢复。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释本包如何实现上述行为；可观察的契约在[使用本包](#use-this-package)中说明。

### 设计概念

本包是一个注册表加一条协作式组装流水线。一次 `assemble()` 调用会合并全局层与所请求作用域的层，分离工具参数，先按编号再按名称规范化片段顺序，运行作用域过滤的 `system-prompt/assemble` 瀑布流，把生效的完整片段恢复为唯一的提示片段，并应用任何活跃的运行时上下文抑制器。片段和动态上下文是相互独立的输入：片段成为提示词文本，而上下文在循环下成为模型历史中带来源的用户角色快照。工具 schema 在设计上就是组装的一部分——“告诉模型它能做什么”是一件事，尽管适配器会把 schema 作为独立的线上字段传输。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`SystemPrompt` 服务、配置、组装流水线、`renderPrompt` |

### 组装与渲染

组装分两个阶段解析和渲染：`assemble()` 返回已解析但未插值的片段、有序的工具 schema，以及针对上下文解析后的所有已注册变量；`renderPrompt()` 则对 `{{variable}}` 引用进行插值（除非片段设置了 `interpolate: false`），丢弃空片段，并用空行连接——严格来说，未知引用、已注册但无值的引用，或格式错误的完整组都会抛错，因为格式错误的提示词比响亮的失败更糟。`toolOrder` 在瀑布流之前规范化收集到的工具（注册顺序是插件加载的副产物）；展示瀑布流不接收工具数组，也无法替换提供方拥有的声明。

### 作用域

作用域片段、变量和工具提供者会为一个 agent 遮蔽全局项，且组装瀑布流按作用域过滤派发。注册表变更通知（`system-prompt/change`）故意不做过滤，因为全局变更会影响每个作用域。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

对大多数消费者来说，包级契约已经足够；当你需要周边领域时，再阅读以下内容。

- [系统提示词子系统](../../../docs/subsystems/system-prompt.md) —— 确切的跨包类型和生成的服务 API。
- [tools 包](../tools/README.md) —— 其 schema 会流入组装的工具注册表。
- [提示变量 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md) —— 每个提示事实由谁拥有。
- [第一方提示顺序 Agent Note](../../../.agents/notes/archived/architecture/2026-08-25-sparse-first-party-prompt-section-orders.md) —— 稀疏的具名 order 分配。
- [核心组地图](../README.md) —— 核心各包如何组合。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

第一方片段依次渲染：Harness 身份、部署人设前缀（包括模型名称介绍）、可复用指令（包括生成的工具 SDK 和结构化输出指引），然后是承载环境信息的后缀：Harness 源码（`10000`）、Web 表面（`10100`）和部署人设后缀（`10200`）。外部的片段 order 和组装监听器仍然具有权威性。`includeHarnessIdentity: false` 只省略那一段固定开头语。空片段会消失；作用域片段和变量可以为单个 agent 遮蔽全局项。`system-prompt/assemble` 瀑布流决定最终交付的提示词，除非某个生效片段声明自己为完整——那个确切的片段随后成为整个系统提示词，而瀑布流产生的上下文和变量仍然保留。工具声明仍由提供方拥有。渲染后的提示词作为派生历史中的 system 角色消息到达模型——即表面节点 0，或在 in-history 更新之后的最新系统节点——循环请求和 `request/header` 都不携带单独的 `system` 字段。若完整渲染为空，循环会通过记录空替换来清空所有活跃的系统节点，因此模型历史中不会残留更早的提示词。有序动态上下文与片段相互独立，仅在存在时成为带来源的用户角色快照；`includeRuntimeContext: false` 或作用域抑制器会移除可选贡献，而必需的操作上下文仍然保留。

##### Harness 身份

```markdown
You are an AI agent powered by DeepSeek Harness.
```

#### Token 影响

启用时，身份是一笔固定的每请求开销。人设前缀、后缀和插件文本会按请求重复，并随其渲染内容而增长。

#### KV 缓存影响

当身份、人设、变量、片段文本和顺序渲染结果完全一致时，前缀保持稳定：未变化的渲染不会触及系统节点，包括在支持能力的路由上开启新的请求序列时；只有不支持能力的路由，或生效文本不同的序列起点，才会合并保留的 in-history 提示词。在没有 `systemPromptUpdate` 的情况下，非空提示词文本会通过记录逐节点替换合并到第一个系统节点，因此头部重写会从第一个变化的 token 起失去前缀复用；当准备好的调用声明 `systemPromptUpdate: 'in-history'` 时，agent 循环会在持续进行的请求序列中把非空的变更提示词追加到缓存历史之后，因此穿过该历史的前缀仍可复用（[决策规则](../agent-loop/README.md#understand-the-implementation)）。在模型、人设前缀、工具和前置指令相同的情况下，不同的源码路径、本地 Web URL 或人设后缀值不会改变可复用的第一方前缀。人设前缀的变化可能改变早期前缀。任何变化都可能从第一个变化的 token 起使复用失效；提供方的缓存共享和实测命中率不保证。

### 工具 schema

#### 模型看到什么

对于随附的工具，模型会收到 [生成的工具 schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-executor-ptc) 中每个 agent 可见的子集，按配置顺序排列，或在应用限制和步骤时激活之后按字典序排列。扩展可以通过同一注册表贡献额外的定义。片段和 schema 提供者是相互独立的组装输入。限制并不会移除片段注册：工具指引插件使用 `text({ scope, toolSet })` 和 `ctx.tools.get(name, scope, toolSet)` 返回空文本或选择合适的片段。任意静态片段不会被自动重写。

#### Token 影响

schema token 会在每个请求中重复。限制某个工具会为该 agent 移除其整个 schema 开销，但不会移除单独的提示片段；重新排序会改变缓存形状，但不改变语义内容。

#### KV 缓存影响

当可见 schema 集合、渲染和顺序保持不变时，前缀保持稳定。注册、限制或重新排序都可能从第一个变化的 schema token 起使复用失效。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了提示词组装何时需要特别留意。它们是当前包的约束，不是任务积压。

- **部署方编写的提示词文本只能通过配置/组合产生** —— 本插件拥有全局人设前缀和后缀默认值，创建者插件可以注册 agent 作用域的遮蔽项，其他片段来自拥有该事实的插件；不存在终端用户的提示词编辑 API。
- **插值文本中没有内联转义语法** —— 当整个片段必须保留字面大括号时，请使用 `interpolate: false`。
- **`toolOrder` 配置错误会在提示词组装时（第一轮）暴露，而不是在启动时** —— 只有形状违规才会在配置加载时抛出。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

无。

</details>

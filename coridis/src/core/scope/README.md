---
description: "面向插件作者与维护者的作用域注册库，用于构建按 agent 或按组隔离贡献项的注册表或事件接口。"
kind: "package-library"
---

# @deepseek-ai/dsh-scope

中文

## 概述

`dsh-scope` 让插件作者为每个 agent 或每个组提供一套隔离的贡献集，并共享同一生命周期。子作用域继承祖先的贡献，最近的定义优先；祖先作用域可以观察后代的活动，但两种关系都不可逆。释放一个作用域会移除它拥有的一切。当需要在不依赖 agent 循环或预设的情况下实现按 agent 或按组的隔离时，使用这个无依赖的库。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

插件作者使用 `dsh-scope` 为一个 agent（或一个组）提供独立的注册世界。核心组中的注册表都构建在它之上——通过 `agent.ctx` 注册的工具只对该 agent 可见——同一个原语也服务于任何自定义注册表或作用域过滤的事件。

### 创建作用域

`createScope(ctx, key)` 在 `ctx` 的 fiber 下创建一个作用域：它的 `ctx` 带有作用域标记，通过它注册的一切都既在作用域内可见，也具有作用域生命周期。`dispose()` 会回卷通过该作用域建立的所有注册；`rawDispose` 是确切的 Cordis disposer，用于把拆卸嵌套进有序的复合 effect 中。

```text
const scope = createScope(ctx, agent)
scope.ctx.on('agent/status', ({ agent, status }) => track(agent, status))
// 之后：
await scope.dispose()   // 回卷通过 scope.ctx 建立的所有注册
```

### 路由作用域事件

`scopeTarget(base, key)` 构建作用域过滤事件派发时携带的不透明载体。未打标记的监听器保持全局；带有 `key` 标记的监听器接收该 key 及其后代的事件。载体只携带路由状态——真正的主体在事件参数中传递。

### 构建作用域注册表层

注册表作者使用 `ScopedLayers`、`NamedEntries` 和 `AnonymousEntries` 来持有一个预先创建的全局层，再加上按需创建的确切作用域层：读取永远不会创建层，`merge()` 会沿作用域链物化按插入顺序排列的命名遮蔽项，`effect()` 从同一上下文推导可见性和所有权。作用域层只有在其整个聚合为空时才会被回收。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释本包如何实现上述行为；可观察的契约在[使用本包](#use-this-package)中说明。

### 设计概念

注册上下文同时决定可见性和所有权：通过作用域上下文建立的注册在该作用域内可见，并随其释放，从而避免一项贡献在一个作用域内可见却随另一个作用域被拆卸。该原语路由的是受信任的同进程插件；它不是沙箱，也不是权限边界。交出一个作用域上下文的同时也交出了创建插件的服务解析 API（解析会沿创建 fiber 的依赖链进行），因此应从那些被作用域注册所需依赖所属的插件来创建作用域。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `createScope`、`scopeOf`、`scopeTarget`、`bindScopeParent`/`scopeParentOf`/`scopeChainOf`、载体标记 |
| [`src/store.ts`](src/store.ts) | `ScopedLayers`、`NamedEntries`、`AnonymousEntries`、`ScopeLayer` |

### 父链

一种关系同时支撑两个方向：注册视图沿链向下继承（子作用域能看到祖先的层），而事件准入沿链向上扩展（带有祖先标记的监听器能收到派发给后代 key 的事件）。绑定只能进行一次——已拥有父级的 key 再次绑定会抛错，且只有返回的绑定对象才能重新链接——每条链都拒绝环。`scopeChainOf` 返回 `[key, parent, …]`，最近的在前。

### 事件过滤

`scopeTarget` 把基础上下文已有的 `Context.filter` 与作用域谓词组合起来：未打标记的监听器被准入；带标记的监听器当且仅当其标记就是派发 key 或它的祖先时被准入；`key === undefined` 只准入未打标记的监听器。`{ global: true }` 监听器绕过过滤。`Scoped<T>` 品牌类型要求把载体作为作用域过滤事件的 `this` 类型，因此用裸主体派发会是编译错误。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

对大多数消费者来说，包级契约已经足够；当你需要周边领域和设计理由时，再阅读以下内容。

- [作用域注册子系统](../../../docs/subsystems/scope.md) —— 身份、载体和层类型。
- [Agent 作用域运行时设计参考](../agent-loop/README.md) —— 循环如何构建每个 agent 的作用域。
- [核心组地图](../README.md) —— 核心各包如何组合。

-----

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了该原语何时需要特别留意。它们是当前包的约束，不是任务积压。

- **只有作用域感知的 API 才能隔离状态** —— 注册表必须按 `scopeOf()` 归类，事件必须通过 `scopeTarget()` 派发；任意 Cordis 服务即使通过作用域上下文调用，也仍然是上下文全局的。
- **一个上下文只携带一个最近的作用域 key** —— 层级存在于 key 级别的父子关系中，而不在上下文标记里；嵌套的作用域上下文仍然会遮蔽为单一标记，多成员策略集仍不受支持。
- **服务可达性来自作用域创建者** —— 交出 `Scope.ctx` 也就交出了创建插件注入的服务，因此更宽泛的创建者无法在之后被持有者收窄。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

无。

</details>

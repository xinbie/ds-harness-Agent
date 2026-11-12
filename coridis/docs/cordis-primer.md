# Cordis primer

Cordis is the plugin framework underneath coridis. This primer covers the ideas a harness plugin
author needs; the upstream repository is <https://github.com/cordiverse/cordis>.
coridis compiles against the DeepSeek Harness vendored fork (`@deepseek-ai/cordis`); import from
that package, not from upstream `cordis`.

## Cordis in five ideas

- **A plugin is an object that can contribute to a context.** It can be a function with optional
  `name`, `inject`, and `apply(ctx)` fields, or a `Service` subclass whose lifecycle Cordis mounts.
- **A context is a repository of services.** A service claims a stable `ctx.<key>` such as
  `ctx.tools`, `ctx.llm`, or `ctx.sessions`; other plugins find services by key instead of importing
  a concrete implementation.
- **Declare service dependency via `inject`.** A plugin that names required services waits until
  those services exist, so load order is expressed through requirements rather than manual boot
  sequencing.
- **Typed events for communication.** Services declare event names through TypeScript declaration
  merging, then dispatch them according to the event's mode.
- **Registrations are reversible effects.** Tools, prompt sections, adapters, providers, and
  listeners are installed through `ctx.effect()` or `ctx.on()`; unload unwinds them predictably.

## Dispatch modes

| Mode | Awaited? | Order | Return value? |
|---|---|---|---|
| `emit` | No | registration order | No |
| `waterfall` | No | registration order | Yes |
| `parallel` | Yes | all listeners concurrently | No |
| `serial` | Yes | registration order | Yes |
| `bail` | No | registration order until one bails | Yes |

The dispatch mode is part of the event's public contract. New events document it with an `@mode`
tag, and an event declared one way must not be dispatched another way.

## Waterfall semantics

`ctx.waterfall` is around-middleware. A listener receives `(...args, next)`. Call `next()` to
delegate the possibly wrapped result to the next listener; return without calling it to
short-circuit. Values propagate through `next()`'s return value.

Cooperative listeners usually mutate a shared request or decision object and delegate. A policy
listener may own the decision and short-circuit; an observer must delegate.

## Practical rules

- Encapsulate behavior into plugins: a tool pipeline event belongs to `ctx.tools`, model streaming
  to `ctx.llm`, live agent coordination to `ctx.agents`.
- Prefer events for interception and policy; prefer service methods for direct capability calls.
- Every registration should have a disposer. If teardown order matters, keep related work in one
  effect so disposal unwinds in the intended sequence.
- Consumers import types only. If a consumer needs a new operation, add it to the Service
  Definition, not to the provider the consumer happens to know about.

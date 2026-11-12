# coridis architecture

Read this before changing anything under `packages/`. It assumes the Cordis ideas in
[cordis-primer.md](cordis-primer.md).

## Cordis

[Cordis](https://github.com/cordiverse/cordis) is the framework under coridis. Plugins contribute
services, typed events, and reversible effects to a shared `Context`. Every part of the product is a
plugin — the model adapter, the tool registry, the filesystem, the agent loop, and the CLI
composition itself — so each is replaceable from configuration.

There is no privileged core to patch. A new capability is mounted beside the others, and its
registrations unwind when the plugin unloads.

## Profiles and bundles

A running coridis is a plugin tree composed at boot from ordered layers.

- A **profile** is a named composition. It lists the bundles it stacks and holds the user's own
  `cordis.patch.yml`. `profiles/headless/profile.yml` is the shipped profile.
- A **bundle** is a distribution format for Cordis config rows and the code they mount. A bundle
  declares its patch in `package.json` under `coridis.bundle.patch`.
- Layers apply to an empty entry list: the profile's ordered bundles, then the user's patch, then
  `--patch` overlays. A patch targets a row by id and replaces its whole `config`, or inserts new
  rows.

`@coridis/base` is the shared first layer: session, model seam and DeepSeek provider, prompt,
tools, filesystem seam and local provider, file tool, web seam and providers, web tool, agent
registry, and loop. `@coridis/headless` adds the one-shot startup provider and runner.

## Core packages

| Package | Owns | `ctx` key |
|---|---|---|
| [`core/session`](../packages/core/session/README.md) | Append-only `SessionEvent` log and in-memory store | `ctx.sessions` |
| [`core/system-prompt`](../packages/core/system-prompt/README.md) | Prompt sections and tool-schema assembly | `ctx.systemPrompt` |
| [`core/tools`](../packages/core/tools/README.md) | Scoped tool registry and guarded execution pipeline | `ctx.tools` |
| [`core/agent`](../packages/core/agent/README.md) | `Agent` interface, live registry, `agent/*` events | `ctx.agents` |
| [`core/agent-loop`](../packages/core/agent-loop/README.md) | The default turn/step driver | driver |
| [`core/scope`](../packages/core/scope/README.md) | Per-agent scoped-registration primitive | library |
| [`llm/llm`](../packages/llm/llm/README.md) | Message and stream vocabulary, adapter seam | `ctx.llm` |

## Capability seams

A **seam** is a swappable capability with three roles: a Service Definition declaring the interface
and owning `ctx.<key>`, a Service Provider implementing it, and a Consumer using it. Adding a
capability means designing all three; see [capability-seams.md](capability-seams.md).

Seams are why one provider swap changes the whole product. Pointing `ctx.fs` at a remote sandbox, or
`ctx.web` at another search vendor, moves every consumer with no provider forks.

## Events

Events are the extension points. Picking the right domain is the first decision in most changes.

- **Session events** are durable facts appended to the log and broadcast through `session/event`.
  Use one when the fact must survive a reload.
- **Agent events** (`agent/*`) carry a live `Agent`: inbox, step, status, pre-step. Use one to
  observe or intercept work in flight.
- **Capability events** attach policy and adapters to a seam (`fs/*`, `tools/*`, `llm/stream`)
  without importing the loop.

Dispatch mode is part of the contract: `emit` observes, `waterfall` wraps, `serial` runs in order
and returns a value, `parallel` fans out, `bail` stops at the first value.

## Turn flow

A **step** is one model request plus the tools it calls. A **turn** is zero or more steps: it opens
before its first input is claimed and closes once nothing is owed.

```text
turn/start
  claim the next-step input
  assemble prompt sections + admitted tool schemas
  -> agent/pre-step
     reject, or an empty first batch -> close the turn with no step
     step/start
     append user/message, request/header, request/context
     derive and freeze model history from the log
     stream the prepared call -> llm/stream
       assistant/message
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     tools owe another request, or next-step input arrived -> claim -> next step
  -> agent/turn-stopping
turn/end
```

`turn/start`, `step/start`, `user/message`, `assistant/message`, `tool/call`, `tool/result`, and
`turn/end` are durable session events. `agent/*` is live coordination. The three `tools/*`
waterfalls may transform the call; only the owning executor writes call/result events.

The full simplified sequence is in [agent-lifecycle.md](agent-lifecycle.md).

## Session log

The session log is the source of context the model sees. `deriveMessages()` projects model history
from it. Every durable settlement — successful message, failed attempt, cancelled attempt — is
recorded, so fork, resume, transcripts, and replay all derive from the same events.

**Model-visible means logged.** Every model request must be reconstructable from the log. New
model-visible inputs require Session events.

## Where new behavior goes

| Goal | Mechanism |
|---|---|
| Add a model provider | register an adapter on `ctx.llm` |
| Add a model-facing capability | register on `ctx.tools`; its schema joins prompt assembly |
| Add a filesystem backend | register a `ctx.fs` provider |
| Add web search or fetch | register a provider on `ctx.web` |
| Intercept a request or tool | use its `agent/*`, `tools/*`, or `llm/stream` event |
| Add model-facing context | append a Session event and add a prompt section |
| Add a human command | extend the CLI and mount a plugin; do not fake a model turn |
| Add a product surface | add a bundle + profile, not a branch in the loop |

## Intentional simplifications

The minimal implementation deliberately leaves out layers that are independent of "everything is a
plugin":

- one in-memory session store, no persistence/fork/migrations yet
- no sandbox, approval, credentials, telemetry, or compaction plugins
- no session projection or query layer
- one host face (no browser/client split)
- no ToolExecutor package; `ctx.tools.execute` owns the batch for now
- the composer reads YAML once at boot; there is no config watcher or hot reload

Each is a future bundle or package, not a loop edit.

# Glossary

One canonical term per concept. Implementation detail belongs in package READMEs.

## harness terms

- **plugin** — a Cordis object that contributes services, events, or effects to a `Context`. A
  function with `apply(ctx)` and optional `inject`, or a `Service` subclass.
- **context** — the shared repository of services that plugins mount into.
- **service** — a capability reachable as `ctx.<key>`, contributed by one plugin. Examples:
  `ctx.tools`, `ctx.llm`, `ctx.fs`, `ctx.web`, `ctx.sessions`, `ctx.agents`.
- **effect** — a registration that returns a disposer and unwinds when its plugin unloads.
- **waterfall** — around-middleware dispatch; a listener calls `next()` to delegate or returns
  early to short-circuit.
- **scope** — the unit of per-agent registration. A contribution is global or owned by exactly one
  scope key; the convention is that a live Agent is the key of its own scope.
- **shadowing** — most-specific-wins resolution: a scoped tool or prompt section replaces its
  same-named global twin for that scope alone.

## composition terms

- **profile** — a named composition: an ordered bundle list plus the user's own patch. Selects what
  a launch boots.
- **bundle** — a distribution format for config rows and their plugins, declared as a
  `cordis.patch.yml` layer in `package.json`.
- **patch** — an ordered list of operations on rows (`insert`, or replace by `id`). Later layers
  win per row.
- **row** — one plugin entry in the composed tree: `id`, `name`, optional `inject`, `config`,
  `disabled`.

## capability terms

- **seam** — a swappable capability with a Service Definition, one or more Service Providers, and
  one or more Consumers. See [capability-seams.md](capability-seams.md).
- **Service Definition** — the seam's service class: owns `ctx.<key>` and the vocabulary types.
- **Service Provider** — an implementation registered on a seam's service.
- **consumer** — a plugin that injects a seam, commonly to expose a model-facing tool.

## loop terms

- **turn** — one drain of admitted input in a session. Opens before its first input is claimed,
  closes once nothing is owed.
- **step** — one model request plus the tool executions caused by its response. A turn contains zero
  or more steps.
- **tool call** — one model-requested invocation, logged before execution; its result is logged
  before the next step derives history.
- **attempt** — one settled model request, including failed, retried, or cancelled attempts that
  produced no assistant message.

## web and fs terms

- **search provider** — a `ctx.web` implementation of query → sources.
- **fetch provider** — a `ctx.web` implementation of URL → readable text.
- **fs provider** — a `ctx.fs` implementation of stat/read in one execution world. Local disk is
  one world, not the default assumption.

# Capability seams

A **seam** is a swappable capability with three roles:

1. **Service Definition** — a Cordis `Service` that owns its `ctx.<key>` and the vocabulary types.
2. **Service Provider** — an implementation that registers itself on that service.
3. **Consumer** — a plugin that injects the service, usually to expose a model-facing tool.

A seam is the complete capability, never one role. A package may own multiple roles when they are
one concern, but Definition and Provider normally live separately so they can evolve apart.

## Seams in the implementation

| Seam | Service Definition | Provider(s) | Consumer(s) |
|---|---|---|---|
| Model | `@coridis/llm` (`ctx.llm`) | `@coridis/llm-deepseek` | `@coridis/agent-loop` |
| Tools | `@coridis/tools` (`ctx.tools`) | tool-contributing plugins | `@coridis/agent-loop` |
| Filesystem | `@coridis/fs` (`ctx.fs`) | `@coridis/fs-local` | `@coridis/tool-fs` |
| Web | `@coridis/web` (`ctx.web`) | `@coridis/web-search-tavily`, `@coridis/web-fetch-http` | `@coridis/tool-web` |
| Agent | `@coridis/agent` (`ctx.agents`) | `@coridis/agent-loop` (factory) | CLI / `@coridis/headless` |
| Session | `@coridis/session` (`ctx.sessions`) | in-memory event store | loop, tools, headless |

The tool registry is a Definition plus a contribution mechanism: `@coridis/tool-fs` and
`@coridis/tool-web` are not "providers" of `ctx.tools`; they contribute definitions to it. The
providers they use are `ctx.fs` and `ctx.web`.

## Selection rules

Providers register under a stable `id`. Selection happens at execution time, never in registration
order:

- a configured provider id that is registered wins (`ctx.web` config `searchProvider` /
  `fetchProvider`, `ctx.fs` config `provider`);
- a configured id that is missing is a typed error (`WEB_PROVIDER_CONFIGURED_MISSING` for web);
- with no configured id, exactly one registered provider auto-selects;
- with no configured id and multiple registered providers, selection is ambiguous and fails loudly;
- model adapters declare disjoint model sets, and registration rejects a second adapter for a
  model that is already served.

No consumer may silently fall back to a hard-coded vendor. Availability probing is a future
provider capability; today "registered" is the selection gate.

## Adding a seam

1. Create `packages/<domain>/<capability>` with the `Service` class, `declare module '@deepseek-ai/cordis'`
   context merge, and the neutral request/result types.
2. Create at least one provider package that imports only the definition and registers on it.
3. Create the consumer package (typically `tool-*`) that injects the service and imports types.
4. Add the provider and consumer rows to a bundle patch.
5. Add tsconfig references and the base `paths` entries.
6. Document the selection semantics and structured error codes in the definition README.

## Anti-patterns

- A tool that imports `node:fs` or `fetch` directly: it has bypassed the seam.
- A provider that imports another provider: providers are siblings, never a chain.
- A consumer that checks `provider instanceof LocalFs`: it now depends on one implementation.
- A service method that exists only for one provider's convenience: extend the neutral contract or
  keep the behavior in the provider.

# coridis

A minimal agent harness assembled from [Cordis](https://github.com/cordiverse/cordis) plugins.
It depends on the DeepSeek Harness vendored fork, `@deepseek-ai/cordis` 4.0.6-alpha.1, rather
than the upstream `cordis` package.
Its package tiering, capability seams, profile/bundle layering, and event vocabulary are modeled on
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) ("everything is a plugin").

> **Status: minimal working agent.** The implementation pass is complete: profiles compose and
> boot, the agent loop drives turns and tool calls, and the shipped `headless` profile runs
> `coridis "<task>"` end to end against DeepSeek, Tavily, and the local filesystem.

## Scope

coridis is the smallest useful agent built on the seams in this repository:

- one model provider: DeepSeek (OpenAI-compatible chat completions)
- three model-facing tools: `web_search`, `web_fetch`, `read`
- one profile: `headless`, a one-shot CLI
- one command: `coridis "<task>"`

## Architecture

A running coridis is a Cordis plugin tree, not a privileged core. Plugins contribute services
(`ctx.llm`, `ctx.tools`, `ctx.fs`, `ctx.web`, `ctx.agents`, ...), typed events, and reversible
effects to a shared context. A **profile** is an ordered list of **bundles**; a bundle is a
`cordis.patch.yml` layer that inserts plugin rows. Every row stays replaceable by a later layer or
by the user's own patch.

Model-facing capabilities are **seams**: a Service Definition owns the interface and `ctx.<key>`,
one or more Service Providers implement it, and consumers (usually tools) use it. Swapping a
provider changes the whole product without touching the agent loop.

```text
apps/cli ──> app-boot ──> profile: base ──> headless
                              │
                              ├─ session      (ctx.sessions)
                              ├─ llm          (ctx.llm) ── llm-deepseek
                              ├─ system-prompt(ctx.systemPrompt)
                              ├─ tools        (ctx.tools)
                              │    ├─ tool-fs  ── fs   (ctx.fs) ── fs-local
                              │    └─ tool-web ── web  (ctx.web) ── web-search-tavily
                              │                                   └─ web-fetch-http
                              ├─ agent        (ctx.agents)
                              └─ agent-loop   (driver)
```

Read [docs/architecture.md](docs/architecture.md) before changing packages.

## Repository layout

```text
coridis/
├── apps/cli/                     # @coridis/cli — the `coridis` bin
├── packages/
│   ├── core/                     # loop, session, prompt, tools, agent, scope
│   │   ├── scope/                # @coridis/scope
│   │   ├── session/              # @coridis/session
│   │   ├── system-prompt/        # @coridis/system-prompt
│   │   ├── tools/                # @coridis/tools
│   │   ├── agent/                # @coridis/agent
│   │   └── agent-loop/           # @coridis/agent-loop
│   ├── llm/                      # @coridis/llm, @coridis/llm-deepseek
│   ├── fs/                       # @coridis/fs, @coridis/fs-local, @coridis/tool-fs
│   ├── web/                      # @coridis/web, providers, @coridis/tool-web
│   ├── boot/app-boot/            # @coridis/app-boot
│   └── bundle/                   # @coridis/base, @coridis/headless
├── profiles/headless/profile.yml # ordered bundle list for the shipped profile
├── docs/                         # architecture, seams, lifecycle, cookbook
├── tsconfig.base.json            # compiler options + workspace paths
├── tsconfig.host.json            # one aggregate program with project references
├── tsdown.config.ts              # workspace bundle build
└── vitest.config.ts
```

## Packages

| Package | Role | Owns / injects |
|---|---|---|
| `@coridis/scope` | library | scope keys, scoped dispatch |
| `@coridis/session` | Service Definition | `ctx.sessions` |
| `@coridis/system-prompt` | Service Definition | `ctx.systemPrompt` |
| `@coridis/tools` | Service Definition | `ctx.tools` |
| `@coridis/agent` | Service Definition | `ctx.agents` |
| `@coridis/agent-loop` | driver / AgentFactory | injects the core services |
| `@coridis/llm` | Service Definition | `ctx.llm` |
| `@coridis/llm-deepseek` | Service Provider | registers on `ctx.llm` |
| `@coridis/fs` | Service Definition | `ctx.fs` |
| `@coridis/fs-local` | Service Provider | registers on `ctx.fs` |
| `@coridis/tool-fs` | Consumer | registers `read` on `ctx.tools` |
| `@coridis/web` | Service Definition | `ctx.web` |
| `@coridis/web-search-tavily` | Service Provider | registers on `ctx.web` |
| `@coridis/web-fetch-http` | Service Provider | registers on `ctx.web` |
| `@coridis/tool-web` | Consumer | registers `web_search`, `web_fetch` |
| `@coridis/app-boot` | boot | profile/bundle composition |
| `@coridis/base` | bundle | first patch layer |
| `@coridis/headless` | bundle + runner | one-shot task mode |
| `@coridis/cli` | app | `coridis` executable |

## Design rules

1. **Everything is a plugin.** No package owns a privileged core; behavior is added by mounting.
2. **Registrations are effects.** Every `register`/`section`/`on` returns a disposer or is scoped to
   its plugin fiber, so unload unwinds cleanly.
3. **Depend on services, not packages.** Declare `inject = ['tools', 'web']`; import types, not
   concrete providers.
4. **Model-visible means logged.** Any input the model sees must be reconstructable from the
   Session log.
5. **Seams have three roles.** Changing a capability means designing Definition, Provider, and
   Consumer together.
6. **One package, one concern.** Provider packages never import each other; consumers never import
   a provider.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build

export DEEPSEEK_API_KEY=...
export TAVILY_API_KEY=...        # only needed for web_search
npm run coridis -- "Find the Cordis plugin docs and summarize the lifecycle"
```

Requires Node.js >= 20.19 and npm >= 10 (both bundled together). The repository is an npm
workspace: internal dependencies use `"*"`, which npm resolves to the sibling package.
`npm run coridis` runs the compiled CLI, so build once first (or use `npm run dev`, which builds
before running).

Useful invocations:

```sh
npm run coridis -- --help                              # usage and environment variables
npm run coridis -- --json "..."                        # newline-delimited Session events
npm run coridis -- --patch ./local.patch.yml "..."     # apply a patch layer after the profile
npm run coridis -- --profile headless "..."            # select a profile from profiles/
```

The CLI reads `DEEPSEEK_API_KEY` for the model and `TAVILY_API_KEY` for web search. Relative
`read` paths resolve against the directory where the CLI runs. `CORIDIS_PROFILE_DIR` overrides the
profile directory.

## Tests

`npm test` runs Vitest against package sources (no build required). The suite covers scope
visibility, Session derivation, prompt assembly, the tool pipeline, adapter selection and wire
mapping, the full agent turn/tool cycle, filesystem confinement, web provider behavior, profile
composition, CLI argument parsing, and a minimal LLM request plus `web_search` Agent turn
(`tests/cordis.spec.ts`).

## Documents

- [Product requirements (Chinese)](docs/product-requirements.md)
- [Architecture](docs/architecture.md)
- [Cordis primer](docs/cordis-primer.md)
- [Capability seams](docs/capability-seams.md)
- [Agent lifecycle](docs/agent-lifecycle.md)
- [Glossary](docs/glossary.md)
- [Module graph](docs/module-graph.md)
- [Development guide](docs/development.md)
- [Adding a package](docs/cookbook/adding-a-package.md)
- [Adding a tool](docs/cookbook/adding-a-tool.md)
- [High-concurrency continuous crawler tutorial (Chinese)](docs/cookbook/continuous-crawler.md)
- [Agent guide](AGENTS.md)

## License

MIT. See [LICENSE](LICENSE).

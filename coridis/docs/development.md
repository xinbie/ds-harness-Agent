# Development guide

## Prerequisites

- Node.js >= 20.19 with npm >= 10 (bundled with Node.js)
- Runtime credentials: `DEEPSEEK_API_KEY` for the model and `TAVILY_API_KEY` for web search

## Setup

```sh
npm install
npm run typecheck
npm test
```

The repository is an npm workspace: the root `package.json` lists `packages/*/*` and `apps/*`
under `workspaces`, and internal dependencies use `"*"` so npm links the sibling packages.

## Commands

| Command | Purpose |
|---|---|
| `npm run typecheck` | `tsc -b tsconfig.host.json` |
| `npm test` | `vitest run` against package sources (build not required) |
| `npm run build` | project references, then the tsdown workspace bundle |
| `npm run dev` | build, then run the compiled CLI |
| `npm run coridis -- ...` | run the built CLI |

## TypeScript layout

- `tsconfig.base.json` holds shared compiler options and the `@coridis/*` source `paths` map. It
  intentionally has no `include`/`files`.
- `tsconfig.host.json` is the single aggregate program: it references every package and
  `apps/cli`.
- Each package has its own `tsconfig.json` with `rootDir: src`, `outDir: lib/types`, and project
  references to its direct dependencies.
- `tsdown.config.ts` bundles `lib/types/index.js` into `lib/index.js` for every workspace
  member. A package whose entry differs adds a local `tsdown.config.ts`: `apps/cli` builds
  `bin`, and `bundle/headless` builds both `index` and `startup`.

Adding a package means touching four places: the package directory, `tsconfig.host.json`
references, the base `paths` map, and each dependent's `tsconfig.json` references. The cookbook
walks through it.

## Tests

Tests live in `packages/<domain>/<package>/tests/*.spec.ts` (or `apps/*/tests`). They should mount a
Cordis context and assert through services and events, not private fields. Test the seam contract:
a fake provider must be interchangeable with the real one.

## Product alignment

`docs/product-requirements.md` is the product source of truth. Before changing behavior:

1. Name the FR/NFR the change serves.
2. If the change alters scope, acceptance criteria, or a non-goal, update the PRD in the same
   change.
3. If code must diverge temporarily, record the gap under the PRD's risks or open questions so the
   spec does not silently go stale.

## Implementation status

The minimal product is implemented end to end along the planned order:

1. `core/scope` + `core/session` + `core/system-prompt` + `core/tools` — registries and events
2. `llm/llm` + `llm/llm-deepseek` — adapter selection and the OpenAI-compatible wire adapter
3. `core/agent` + `core/agent-loop` — one turn/step driver with tool-call cycles and a step cap
4. `fs/fs` + `fs/fs-local` + `fs/tool-fs` — confined local reads and the `read` tool
5. `web/web` + `web-fetch-http` + `web-search-tavily` + `web/tool-web` — the two web tools
6. `boot/app-boot` + `apps/cli` + `bundle/headless` — profile composition and the one-shot runner
7. tests and structured errors

Known boundaries are listed under "Intentional simplifications" in
[architecture.md](architecture.md#intentional-simplifications). In particular, sessions are
in-memory, the composer does not watch files, and `read` is the only filesystem tool.

When changing behavior, add or update a spec in the owning package's `tests/` directory and run
`npm run typecheck`, `npm test`, and `npm run build`.

## Conventions

- Runtime imports use `.ts` extensions; `rewriteRelativeImportExtensions` emits `.js`.
- `verbatimModuleSyntax` is on: use `import type` for type-only imports.
- Public package entry points export `name`, `inject` (when applicable), `Config` (when
  configurable), and `apply` — or a `Service` class for a definition.
- No package may import from another package's `src/` internals.

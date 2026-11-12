# Agent guide

Read [docs/product-requirements.md](docs/product-requirements.md) and
[docs/architecture.md](docs/architecture.md) before changing behavior.
The design is copied from DeepSeek Harness: a Cordis plugin tree with no privileged core.

## Non-negotiables

- **Everything is a plugin.** New behavior is a mounted plugin or an event listener, not a branch
  inside a central module. If a package needs a hook that does not exist, add it to the owning
  service's event contract.
- **Services are found by key.** Consumers declare `inject = ['tools', 'web']` and import types only.
  Never import a provider package from a consumer or another provider.
- **Registrations are reversible.** Every registry method returns a disposer or registers through
  `ctx.effect()`; every listener goes through `ctx.on()`. Unload must leave no residue.
- **Seams have three roles.** When adding a capability, create the Service Definition, at least one
  Provider, and the Consumer separately. A tool alone is not a seam.
- **Model-visible means logged.** If the model can see it, it must be derivable from Session events.
- **One package, one concern.** Package boundaries carry the architecture; do not merge domains to
  avoid a manifest edit.
- **Align with the product requirements.** `docs/product-requirements.md` is the source of truth for
  product scope. Map a behavior change to its FR/NFR; if the change alters scope, acceptance, or a
  non-goal, update the PRD in the same change instead of letting code and spec drift.

## Implementation status

The minimal product is implemented: the `headless` profile boots through `app-boot`, the agent loop
drives turns and tool calls, and the three tools run against DeepSeek, Tavily, and the local
filesystem. When changing it:

- Keep the declared contracts (`Config`, service classes, event signatures) stable; extend them
  rather than inventing parallel APIs.
- Add or update a spec in the owning package's `tests/` directory for every behavior change, then
  run `npm run typecheck`, `npm test`, and `npm run build`.
- Keep every package's `README.md` role section in sync with its actual role.
- Preserve the seam split: a new capability still needs a Definition, a Provider, and a Consumer.
- Avoid adding runtime dependencies; the harness intentionally uses `@deepseek-ai/cordis`, `js-yaml`,
  and Node built-ins for its core.

## Package conventions

Each package follows the same shape:

```text
packages/<domain>/<name>/
├── package.json      # name, exports, peerDependencies, coridis.bundle.patch (bundles only)
├── tsconfig.json     # extends ../../../tsconfig.base.json; references direct dependencies
├── README.md         # role + status
├── src/
│   └── index.ts      # plugin exports: name, inject, Config, apply (or a Service class)
└── tests/            # vitest specs, named *.spec.ts
```

- Internal dependencies use `"*"` in both `peerDependencies` and `devDependencies`; npm workspaces
  resolve them to the sibling package.
- `@deepseek-ai/cordis` is always a peer dependency for plugin packages.
- `schemastery` is a runtime `dependency` when the package exports a `Config` schema.
- Bundles declare `"coridis": { "bundle": { "patch": "./cordis.patch.yml" } }`.
- The root tsdown workspace entry is `lib/types/index.js`; add a package-local
  `tsdown.config.ts` when the entry differs (`apps/cli` → `bin`, `bundle/headless` →
  `index` + `startup`).
- Add the package to `tsconfig.host.json` references, `tsconfig.base.json` paths, and its
  dependents' `tsconfig.json` references.

## Commands

```sh
npm run typecheck        # tsc -b tsconfig.host.json
npm test                 # vitest
npm run build            # tsc -b + tsdown workspace bundle
npm run coridis -- --help
```

## Review checklist

1. Is the new behavior a plugin contribution with a disposer?
2. Does any consumer import a provider or a concrete implementation?
3. Is every model-visible fact backed by a Session event?
4. Are `Config` fields documented, defaulted, and validated?
5. Did `tsconfig.host.json` and the base `paths` map gain the package?
6. Does `npm run typecheck` pass, and does every touched package still have a truthful README?

# Cookbook: adding a package

Use this when a new concern deserves its own package. If the concern is one tool over an existing
seam, read [adding-a-tool.md](adding-a-tool.md) instead.

## 1. Pick the tier and the name

```text
packages/<domain>/<name>/     e.g. packages/web/web-search-brave/
apps/<name>/                  only for a product assembly
```

The package name is `@coridis/<name>`. One package owns one concern; a seam's Definition and
Provider stay in separate packages unless they are inseparable.

## 2. Create the directory

```text
packages/<domain>/<name>/
├── package.json
├── tsconfig.json
├── README.md
├── src/index.ts
└── tests/.gitkeep
```

## 3. Write `package.json`

Copy the shape from a sibling. Required fields:

```json
{
  "name": "@coridis/<name>",
  "description": "<one sentence>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/types/**/*.d.ts"],
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.0.6-alpha.1",
    "@coridis/<dependency>": "*"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "~4.0.6-alpha.1",
    "@coridis/<dependency>": "*"
  }
}
```

Add `schemastery` to `dependencies` if the package exports a `Config` schema. Bundles add
`coridis.bundle.patch` plus the patch file.

## 4. Write `tsconfig.json`

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"],
  "references": [{ "path": "../../<domain>/<dependency>" }]
}
```

`apps/*` extends `../../tsconfig.base.json`.

## 5. Write `src/index.ts`

A plugin exports:

```ts
export const name = '<name>'
export const inject = ['<service>']
export interface Config { /* documented, defaulted */ }
export function apply(ctx: Context, config: Config = {}): void {
  // register effects; each returns a disposer or is fiber-scoped
}
```

A Service Definition exports a `Service` subclass plus a `declare module '@deepseek-ai/cordis'` context merge.
Consumers import types only.

## 6. Register the package

1. Add `{"path": "./packages/<domain>/<name>"}` to `tsconfig.host.json` references.
2. Add `"@coridis/<name>": ["./packages/<domain>/<name>/src/index.ts"]` to the base `paths` map.
3. Add a project reference from every direct dependent's `tsconfig.json`.
4. Add a row to the owning bundle patch (`packages/bundle/*/cordis.patch.yml`).
5. Add the package to the table in README.md if it is architectural.

## 7. Verify

```sh
npm install
npm run typecheck
npm test
```

Then confirm the architecture rules in [../capability-seams.md](../capability-seams.md): no consumer
imports a provider, no provider imports another provider, and every registration has a disposer.

# @coridis/base

The shared first bundle layer: model, tools, fs, web, and agent loop.

**Status: implemented.** This bundle is configuration; its rows are exercised by the end-to-end
`headless` profile run.

## Role

The first bundle layer. Its `cordis.patch.yml` inserts the core services, the DeepSeek,
Tavily, and HTTP providers, both tool suites, and the agent loop. Later bundles and user
patches address these rows by `id`; a patch replaces a row's whole `config`.

## See also

- [architecture](../../../docs/architecture.md)
- [capability seams](../../../docs/capability-seams.md)

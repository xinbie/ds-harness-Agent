# @coridis/web

Web capability seam (ctx.web): search/fetch provider registries.

**Status: implemented.** Behavior is covered by specs in `tests/` under this package.

## Role

Service Definition for `ctx.web`. It maintains search and fetch provider registries with
duplicate-id rejection and configured-or-unambiguous selection. It exposes `search`/`fetch`
and typed `WebError` codes and imports no concrete provider.

## See also

- [architecture](../../../docs/architecture.md)
- [capability seams](../../../docs/capability-seams.md)

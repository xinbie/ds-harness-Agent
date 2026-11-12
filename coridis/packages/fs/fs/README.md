# @coridis/fs

Filesystem capability seam (ctx.fs): provider registry and read/stat contract.

**Status: implemented.** Behavior is covered by specs in `tests/` under this package.

## Role

Service Definition for `ctx.fs`. It registers providers by id, selects a configured or sole
provider, exposes `stat`/`readText`, and emits `fs/observed` after reads. Registering multiple
providers without configuring one is an error, not a silent first-wins fallback.

## See also

- [architecture](../../../docs/architecture.md)
- [capability seams](../../../docs/capability-seams.md)

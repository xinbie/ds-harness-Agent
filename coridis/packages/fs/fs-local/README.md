# @coridis/fs-local

Local-filesystem provider for ctx.fs.

**Status: implemented.** Behavior is covered by specs in `tests/` under this package.

## Role

Provider for `ctx.fs`. It resolves paths against a configured `cwd`, rejects lexical escapes
and symlink escapes via `realpath`, and reads UTF-8 text through `node:fs`. It is the only
fs-domain package allowed to import `node:fs`.

## See also

- [architecture](../../../docs/architecture.md)
- [capability seams](../../../docs/capability-seams.md)

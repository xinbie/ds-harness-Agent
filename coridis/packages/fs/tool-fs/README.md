# @coridis/tool-fs

Model-facing file tools over ctx.fs: the read tool.

**Status: implemented.** Behavior is covered by specs in `tests/` under this package.

## Role

Consumer of `ctx.fs` and `ctx.tools`. It registers the `read` tool (`path`, `offset`, `limit`)
with line-numbered windows capped by `readLimit`, plus the `tools/fs` prompt section. Paths go
through the fs provider, so the tool never imports `node:fs`.

## See also

- [architecture](../../../docs/architecture.md)
- [capability seams](../../../docs/capability-seams.md)

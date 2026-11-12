# @coridis/tool-web

Model-facing web_search and web_fetch tools over ctx.web.

**Status: implemented.** Behavior is covered by specs in `tests/` under this package.

## Role

Consumer of `ctx.web` and `ctx.tools`. It registers `web_search` and `web_fetch` with schemas,
argument validation, result caps, and the `tools/web` prompt section. Malformed and non-http(s)
URLs are rejected before any provider call.

## See also

- [architecture](../../../docs/architecture.md)
- [capability seams](../../../docs/capability-seams.md)

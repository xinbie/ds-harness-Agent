# @coridis/scope

Per-agent scoped-registration primitive: global vs scope-owned contributions.

**Status: implemented.** Behavior is covered by specs in `tests/` under this package.

## Role

A library, not a plugin; it owns no `ctx.<key>`. It exports `ScopeKey`, `Scoped`, the
`scopeTarget`/`scopeOf`/`isScopeVisible` dispatch helpers, and `ScopeLayer` — the global/scoped
table used by the tool registry. A scoped entry shadows a global entry with the same key and
unwinds with its Agent scope.

## See also

- [architecture](../../../docs/architecture.md)
- [capability seams](../../../docs/capability-seams.md)

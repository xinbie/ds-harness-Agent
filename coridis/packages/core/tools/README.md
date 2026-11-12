# @coridis/tools

Scoped tool registry and the guarded tool execution pipeline.

**Status: implemented.** Behavior is covered by specs in `tests/` under this package.

## Role

Service Definition for `ctx.tools`. It owns the scoped `ToolDefinition` registry
(`tools/change`) and `execute()`: `tools/pre-execute` → `tools/execute` →
`tools/post-execute` → `tools/result`. Thrown errors become `isError` results, and result
observers cannot change outcomes. It also exports `defineTool` and `toToolSchema`.

## See also

- [architecture](../../../docs/architecture.md)
- [capability seams](../../../docs/capability-seams.md)

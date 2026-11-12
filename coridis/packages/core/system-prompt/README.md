# @coridis/system-prompt

Prompt-section registry and per-step prompt/tool-schema assembly.

**Status: implemented.** Behavior is covered by specs in `tests/` under this package.

## Role

Service Definition for `ctx.systemPrompt`. It holds named sections ordered by `SECTION_ORDER`,
evaluates function sections per assembly, and exposes the `system-prompt/assemble` waterfall.
Assembly returns the system text plus the tool schemas admitted for that step.

## See also

- [architecture](../../../docs/architecture.md)
- [capability seams](../../../docs/capability-seams.md)

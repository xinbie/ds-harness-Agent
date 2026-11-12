# @coridis/cli

coridis CLI: profile launch and one-shot task invocation.

**Status: implemented.** Behavior is covered by specs in `tests/` under this package.

## Role

The `coridis` executable. `parseArgs` handles the task, `--profile`, repeatable `--patch`,
`--json`, help, and version. `runProfile` boots the chosen profile with an in-memory startup
patch, waits for `ctx.headlessRun.done`, reports errors with stable exit codes, and treats a
closed stdout (EPIPE) as a clean end of output.

## See also

- [architecture](../../docs/architecture.md)
- [capability seams](../../docs/capability-seams.md)

# @coridis/headless

One-shot task bundle: start the agent, stream the answer, exit.

**Status: implemented.** Behavior is covered by specs in `tests/` under this package.

## Role

The shipped profile bundle plus the one-shot runner. `startup` publishes `headlessStartup`
values from the CLI, and the runner injects `agents`/`sessions`, creates an Agent, submits the
task, waits for idle, and exposes `ctx.headlessRun`. It prints final text, or NDJSON Session
events in `--json` mode.

## See also

- [architecture](../../../docs/architecture.md)
- [capability seams](../../../docs/capability-seams.md)

# @coridis/agent

Agent interface, live registry, and agent/* event vocabulary.

**Status: implemented.** Behavior is covered by specs in `tests/` under this package.

## Role

Service Definition for `ctx.agents`. It owns the `Agent` interface, the live registry, and the
AgentFactory seam: `create` delegates to the mounted factory, awaits the `agent/created` serial
event, and returns an owning handle. It publishes `agent/status` and `agent/inbox/inserted`
and exposes the `agent/pre-step` waterfall.

## See also

- [architecture](../../../docs/architecture.md)
- [capability seams](../../../docs/capability-seams.md)

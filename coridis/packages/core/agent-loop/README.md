# @coridis/agent-loop

The concrete turn/step driver implementing the Agent interface.

**Status: implemented.** Behavior is covered by specs in `tests/` under this package.

## Role

Driver and AgentFactory. It injects `agents`, `sessions`, `llm`, `tools`, and `systemPrompt`;
configures `model`, `maxSteps`, and `maxParallelToolCalls`; and runs each turn as prompt →
stream → assistant message → tool calls. Every step is recorded in the Session, and fatal
turn errors (including a reached step cap) are exposed through `Agent.lastError`.

## See also

- [architecture](../../../docs/architecture.md)
- [capability seams](../../../docs/capability-seams.md)

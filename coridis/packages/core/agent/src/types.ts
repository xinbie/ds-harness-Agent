/**
 * The public Agent handle and creation options.
 *
 * @module @coridis/agent
 */

/** Live lifecycle state of an Agent. */
export type AgentStatus = 'idle' | 'running'

/** Handle used by UI, CLI, SDK, and subagent consumers. */
export interface Agent {
  readonly id: string
  readonly sessionId: string
  readonly status: AgentStatus
  /** Queue a human message; wakes the driver when idle. */
  followup(message: string): void
  /** Resolve once the driver has no queued work. */
  whenIdle(): Promise<void>
  /** Last fatal turn error, if any. */
  readonly lastError: Error | undefined
}

/** Inputs for creating one Agent. */
export interface CreateAgentOptions {
  readonly sessionId?: string
  readonly cwd?: string
}

/** Owned handle returned by the registry factory. */
export interface AgentHandle {
  readonly agent: Agent
  dispose(): Promise<void>
}

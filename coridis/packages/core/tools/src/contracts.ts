/**
 * Model-facing tool contracts: definitions, calls, and normalized results.
 *
 * @module @coridis/tools
 */

import type { ScopeKey } from '@coridis/scope'

/** One text or image block returned by a tool. */
export type ToolContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mimeType: string; readonly data: string }

/** Value returned by a tool body. */
export interface ToolResult {
  readonly content: readonly ToolContent[]
  readonly isError?: boolean
}

/** Runtime facts available to one tool invocation. */
export interface ToolExecution {
  readonly name: string
  readonly args: Readonly<Record<string, unknown>>
  /** The calling Agent, when the call came from a model step. */
  readonly agent?: unknown
  readonly signal?: AbortSignal
}

/** Normalized outcome after the execution pipeline settles. */
export interface ToolExecutionResult {
  readonly content: readonly ToolContent[]
  readonly isError: boolean
}

/** A tool contributed by a plugin; schemas join prompt assembly. */
export interface ToolDefinition {
  readonly name: string
  readonly description: string
  /** JSON Schema for the model-facing arguments object. */
  readonly parameters: Readonly<Record<string, unknown>>
  execute(
    args: Readonly<Record<string, unknown>>,
    execution: ToolExecution,
  ): Promise<ToolResult>
}

/** Options accepted when registering a tool. */
export interface ToolRegistrationOptions {
  /** Restrict visibility to one Agent scope; omitted means global. */
  readonly scope?: ScopeKey
}

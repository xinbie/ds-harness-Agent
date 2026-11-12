/**
 * Provider-neutral model vocabulary shared by the service, adapters, and
 * consumers. This module contains types only.
 *
 * @module @coridis/llm
 */

/** Who produced a message. */
export type Role = 'system' | 'user' | 'assistant' | 'tool'

/** Plain text content. */
export interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

/** One model-requested tool call. */
export interface ToolCallBlock {
  readonly type: 'tool-call'
  readonly id: string
  readonly name: string
  /** Raw JSON string produced by the model. */
  readonly arguments: string
}

/** One tool result returned to the model. */
export interface ToolResultBlock {
  readonly type: 'tool-result'
  readonly toolCallId: string
  readonly content: string
  readonly isError?: boolean
}

/** Any content block that can appear in a message. */
export type ContentBlock = TextBlock | ToolCallBlock | ToolResultBlock

/** One provider-neutral message. */
export interface Message {
  readonly role: Role
  readonly content: string | readonly ContentBlock[]
}

/** A tool declaration sent with a request. */
export interface ToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
}

/** Why a model stream ended. */
export type FinishReason = 'stop' | 'tool-calls' | 'length' | 'error'

/** One chunk emitted by an adapter. */
export type StreamChunk =
  | { readonly type: 'text-delta'; readonly text: string }
  | { readonly type: 'tool-call'; readonly call: ToolCallBlock }
  | { readonly type: 'finish'; readonly reason: FinishReason }

/** One model request. */
export interface StreamRequest {
  readonly model: string
  readonly messages: readonly Message[]
  readonly tools?: readonly ToolSchema[]
  readonly signal?: AbortSignal
}

/** Contract a model provider implements. */
export interface LlmAdapter {
  readonly id: string
  readonly models: readonly string[]
  stream(request: StreamRequest): AsyncIterable<StreamChunk>
}

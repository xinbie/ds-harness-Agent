/**
 * Whole-stream assembly for consumers that need text and tool calls together
 * instead of handling each chunk.
 *
 * @module @coridis/llm
 */

import type { FinishReason, StreamChunk, ToolCallBlock } from './types.ts'

/** Compacted view of one assistant stream. */
export interface AssistantStreamRecord {
  /** Chunks in emission order. */
  readonly chunks: readonly StreamChunk[]
  /** Concatenated text deltas. */
  readonly text: string
  /** Tool calls in emission order. */
  readonly toolCalls: readonly ToolCallBlock[]
  /** Terminal finish reason. */
  readonly reason: FinishReason
}

/** Assemble an in-memory chunk list. */
export function assembleChunks(chunks: readonly StreamChunk[]): AssistantStreamRecord {
  let text = ''
  const toolCalls: ToolCallBlock[] = []
  let reason: FinishReason | undefined

  for (const chunk of chunks) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'tool-call') toolCalls.push(chunk.call)
    else reason = chunk.reason
  }

  if (reason === undefined) {
    throw new Error('stream ended without a finish chunk')
  }
  return { chunks: [...chunks], text, toolCalls, reason }
}

/**
 * Consume a stream to completion and return its compacted record. Rejects when
 * the stream fails or ends without a `finish` chunk.
 */
export async function assembleStream(
  chunks: AsyncIterable<StreamChunk>,
): Promise<AssistantStreamRecord> {
  const collected: StreamChunk[] = []
  for await (const chunk of chunks) collected.push(chunk)
  return assembleChunks(collected)
}

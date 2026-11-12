/**
 * Scoped tool registry and the guarded execution pipeline. Tools are
 * contributions; executors, policy, and rendering attach through events, so a
 * different product keeps the same tool bodies.
 *
 * @module @coridis/tools
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolSchema } from '@coridis/llm'
import { ScopeLayer } from '@coridis/scope'
import type { ScopeKey } from '@coridis/scope'
import './events.ts'
import type {
  ToolContent,
  ToolDefinition,
  ToolExecution,
  ToolExecutionResult,
  ToolRegistrationOptions,
  ToolResult,
} from './contracts.ts'

export * from './contracts.ts'

interface RegisteredTool {
  readonly definition: ToolDefinition
  readonly scope: ScopeKey | undefined
}

/** Tool registry service; registered as `ctx.tools`. */
export class ToolsService extends Service {
  private readonly layer = new ScopeLayer<RegisteredTool>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  /** Register a definition; return the effect disposer. */
  register(definition: ToolDefinition, options: ToolRegistrationOptions = {}): () => void {
    if (definition.name.trim() === '') {
      throw new Error('tool name must not be empty')
    }
    return this.ctx.effect(() => {
      const dispose = this.layer.register(
        definition.name,
        { definition, scope: options.scope },
        options.scope,
      )
      this.ctx.emit('tools/change')
      return () => {
        dispose()
        this.ctx.emit('tools/change')
      }
    }, `ctx.tools.register(${JSON.stringify(definition.name)})`)
  }

  /** Resolve a visible definition by name and scope. */
  get(name: string, scope?: ScopeKey): ToolDefinition | undefined {
    return this.layer.get(name, scope)?.definition
  }

  /** List the definitions visible in one scope. */
  list(scope?: ScopeKey): readonly ToolDefinition[] {
    return this.layer.list(scope).map(entry => entry.definition)
  }

  /** Run the raw batch through pre-execute, execute, and post-execute. */
  async execute(
    batch: readonly ToolExecution[],
    options: { readonly maxParallel?: number } = {},
  ): Promise<readonly ToolExecutionResult[]> {
    const concurrency = Math.max(1, Math.floor(options.maxParallel ?? (batch.length || 1)))
    const results = new Array<ToolExecutionResult>(batch.length)
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (true) {
        const index = cursor++
        const execution = batch[index]
        if (execution === undefined) return
        results[index] = await this.runOne(execution)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, batch.length) }, () => worker()),
    )
    return results
  }

  private async runOne(execution: ToolExecution): Promise<ToolExecutionResult> {
    const scope = typeof execution.agent === 'object' && execution.agent !== null
      ? execution.agent
      : undefined
    const definition = this.get(execution.name, scope)
    if (definition === undefined) {
      return this.settle(execution, errorResult(`Unknown tool "${execution.name}".`))
    }

    const allowed = await this.ctx.waterfall(
      'tools/pre-execute',
      execution,
      async () => true,
    )
    if (!allowed) {
      return this.settle(execution, errorResult(`Tool "${execution.name}" was denied by policy.`))
    }

    let result: ToolExecutionResult
    try {
      result = await this.ctx.waterfall(
        'tools/execute',
        execution,
        async () => normalizeResult(await definition.execute(execution.args, execution)),
      )
    } catch (error) {
      result = errorResult(`Tool "${execution.name}" failed: ${describeError(error)}`)
    }

    const post = await this.ctx.waterfall(
      'tools/post-execute',
      execution,
      result,
      async () => result,
    )
    return this.settle(execution, normalizeResult(post))
  }

  private settle(
    execution: ToolExecution,
    result: ToolExecutionResult,
  ): ToolExecutionResult {
    try {
      this.ctx.emit('tools/result', execution, result)
    } catch {
      // Observation must not change the outcome.
    }
    return result
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tools: ToolsService
  }
}

/** Identity helper that gives a tool literal its model-facing shape. */
export function defineTool(definition: ToolDefinition): ToolDefinition {
  return definition
}

/** Project a definition onto the model-facing schema accepted by `ctx.llm`. */
export function toToolSchema(definition: ToolDefinition): ToolSchema {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
  }
}

function normalizeResult(result: ToolResult): ToolExecutionResult {
  const content: readonly ToolContent[] = Array.isArray(result.content)
    ? result.content
    : [{ type: 'text', text: '' }]
  return { content, isError: result.isError === true }
}

function errorResult(message: string): ToolExecutionResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Cordis mounts the service class directly. */
export default ToolsService

/**
 * Tool pipeline events. Each stage may transform the call or outcome; the
 * pipeline never changes the loop, only the call passing through it.
 *
 * @module @coridis/tools
 */

import type { Scoped } from '@coridis/scope'
import type { ToolExecution, ToolExecutionResult } from './contracts.ts'
import type { ToolsService } from './index.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Allow, deny, or ask before dispatch. Call `next()` to delegate.
     * @mode waterfall
     */
    'tools/pre-execute'(
      this: Scoped<ToolsService>,
      exec: ToolExecution,
      next: () => Promise<boolean>,
    ): Promise<boolean>

    /**
     * Around-dispatch waterfall for timeout, retry, and metrics.
     * @mode waterfall
     */
    'tools/execute'(
      this: Scoped<ToolsService>,
      exec: ToolExecution,
      next: () => Promise<ToolExecutionResult>,
    ): Promise<ToolExecutionResult>

    /**
     * Accept, replace, enrich, or block a normalized result.
     * @mode waterfall
     */
    'tools/post-execute'(
      this: Scoped<ToolsService>,
      exec: ToolExecution,
      result: Readonly<ToolExecutionResult>,
      next: () => Promise<ToolExecutionResult>,
    ): Promise<ToolExecutionResult>

    /**
     * Observe the frozen final outcome; listener failures are contained.
     * @mode emit
     */
    'tools/result'(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): void

    /**
     * A tool was registered or unregistered.
     * @mode emit
     */
    'tools/change'(): void
  }
}

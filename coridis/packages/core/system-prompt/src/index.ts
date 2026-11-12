/**
 * Prompt-section registry and per-step prompt/tool-schema assembly. Plugins
 * contribute sections as reversible effects; the agent loop requests one
 * assembly per step with the step's admitted tool set.
 *
 * @module @coridis/system-prompt
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolSchema } from '@coridis/llm'
import type { ScopeKey } from '@coridis/scope'

/** Well-known section slots. Contributors pick the nearest stable slot. */
export const SECTION_ORDER = {
  persona: 0,
  guidance: 100,
  tools: 200,
  user: 500,
} as const

/** Inputs available while one prompt is assembled. */
export interface AssembleContext {
  readonly scope?: ScopeKey
  /** Tool schemas admitted for this step. */
  readonly tools?: readonly ToolSchema[]
}

/** One ordered block of system guidance. */
export interface PromptSection {
  readonly name: string
  readonly order: number
  readonly text: string | ((context: AssembleContext) => string)
}

/** The assembled system text plus the tool schemas the model may call. */
export interface PromptAssembly {
  readonly system: string
  readonly tools: readonly ToolSchema[]
}

/** Plugin configuration. */
export interface Config {
  /** Replaces the default persona section when present. */
  readonly personaPrefix?: string
}

/** Prompt assembly service; registered as `ctx.systemPrompt`. */
export class SystemPromptService extends Service {
  private readonly sections = new Map<string, PromptSection>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'systemPrompt')
    const persona = config.personaPrefix?.trim()
    if (persona) {
      this.setSection({ name: 'persona', order: SECTION_ORDER.persona, text: persona })
    } else {
      this.setSection({
        name: 'persona',
        order: SECTION_ORDER.persona,
        text: 'You are coridis, a minimal helpful agent. Be direct and use tools when they help.',
      })
    }
  }

  /** Register a section and return its disposer. */
  section(section: PromptSection): () => void {
    return this.ctx.effect(() => {
      const previous = this.sections.get(section.name)
      this.sections.set(section.name, section)
      return () => {
        if (previous === undefined) this.sections.delete(section.name)
        else this.sections.set(section.name, previous)
      }
    }, `ctx.systemPrompt.section(${JSON.stringify(section.name)})`)
  }

  /** Resolve the numeric order reserved for a well-known section. */
  getSectionOrder(name: string): number {
    return (SECTION_ORDER as Record<string, number | undefined>)[name] ?? SECTION_ORDER.user
  }

  /** Assemble sections and admitted tool schemas for one step. */
  async assemble(context: AssembleContext): Promise<PromptAssembly> {
    return this.ctx.waterfall(
      'system-prompt/assemble',
      context,
      async () => this.build(context),
    )
  }

  private build(context: AssembleContext): PromptAssembly {
    const blocks = [...this.sections.values()]
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
      .map(section => typeof section.text === 'function' ? section.text(context) : section.text)
      .map(text => text.trim())
      .filter(text => text !== '')
    return {
      system: blocks.join('\n\n'),
      tools: context.tools ?? [],
    }
  }

  private setSection(section: PromptSection): void {
    this.sections.set(section.name, section)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    systemPrompt: SystemPromptService
  }

  interface Events {
    /**
     * Waterfall around assembly; listeners may add, replace, or remove
     * sections. Must call `next()` to delegate.
     * @mode waterfall
     */
    'system-prompt/assemble'(
      context: AssembleContext,
      next: () => Promise<PromptAssembly>,
    ): Promise<PromptAssembly>
  }
}

/** Cordis mounts the service class directly. */
export default SystemPromptService

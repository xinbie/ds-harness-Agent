import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SECTION_ORDER, SystemPromptService } from '../src/index.ts'

async function mount(config?: { personaPrefix?: string }): Promise<{
  ctx: Context
  prompt: SystemPromptService
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPromptService, config)
  return { ctx, prompt: ctx.systemPrompt }
}

describe('SystemPromptService', () => {
  it('uses the built-in persona and orders sections by slot then name', async () => {
    const { prompt } = await mount()
    prompt.section({ name: 'z-user', order: SECTION_ORDER.user, text: 'User section.' })
    prompt.section({ name: 'tools-b', order: SECTION_ORDER.tools, text: 'B tool.' })
    prompt.section({ name: 'guidance', order: SECTION_ORDER.guidance, text: 'Guidance.' })
    prompt.section({ name: 'tools-a', order: SECTION_ORDER.tools, text: 'A tool.' })

    const result = await prompt.assemble({})
    expect(result.system).toBe([
      'You are coridis, a minimal helpful agent. Be direct and use tools when they help.',
      'Guidance.',
      'A tool.',
      'B tool.',
      'User section.',
    ].join('\n\n'))
  })

  it('accepts a persona override and evaluates function sections', async () => {
    const { prompt } = await mount({ personaPrefix: '  Custom persona.  ' })
    prompt.section({
      name: 'context',
      order: SECTION_ORDER.guidance,
      text: context => `Tools: ${context.tools?.map(tool => tool.name).join(', ') ?? 'none'}`,
    })

    const result = await prompt.assemble({
      tools: [{ name: 'read', description: 'Read.', parameters: {} }],
    })

    expect(result.system).toBe('Custom persona.\n\nTools: read')
    expect(result.tools.map(tool => tool.name)).toEqual(['read'])
  })

  it('drops empty sections and defaults the tool list', async () => {
    const { prompt } = await mount({ personaPrefix: 'Persona.' })
    prompt.section({ name: 'blank', order: 10, text: '   ' })
    const result = await prompt.assemble({})
    expect(result.system).toBe('Persona.')
    expect(result.tools).toEqual([])
  })

  it('unregisters sections through the returned disposer', async () => {
    const { prompt } = await mount({ personaPrefix: 'Persona.' })
    const dispose = prompt.section({ name: 'extra', order: 50, text: 'Extra.' })
    expect((await prompt.assemble({})).system).toContain('Extra.')
    dispose()
    expect((await prompt.assemble({})).system).not.toContain('Extra.')
  })

  it('exposes the waterfall for last-minute assembly changes', async () => {
    const { ctx, prompt } = await mount({ personaPrefix: 'Persona.' })
    ctx.on('system-prompt/assemble', async (_context, next) => {
      const assembly = await next()
      return { ...assembly, system: `${assembly.system}\n\nInjected.` }
    })

    expect((await prompt.assemble({})).system).toBe('Persona.\n\nInjected.')
  })

  it('resolves well-known section orders', async () => {
    const { prompt } = await mount()
    expect(prompt.getSectionOrder('guidance')).toBe(SECTION_ORDER.guidance)
    expect(prompt.getSectionOrder('unknown')).toBe(SECTION_ORDER.user)
  })
})

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { defineTool, toToolSchema, ToolsService } from '../src/index.ts'
import type { ToolDefinition } from '../src/index.ts'

async function mount(): Promise<{ ctx: Context; tools: ToolsService }> {
  const ctx = new Context()
  await ctx.plugin(ToolsService)
  return { ctx, tools: ctx.tools }
}

function textTool(name: string, body: (args: Readonly<Record<string, unknown>>) => string | Promise<string>): ToolDefinition {
  return defineTool({
    name,
    description: `${name} tool`,
    parameters: { type: 'object' },
    async execute(args) {
      return { content: [{ type: 'text', text: await body(args) }] }
    },
  })
}

describe('ToolsService', () => {
  it('registers, lists, resolves, and unregisters tools', async () => {
    const { ctx, tools } = await mount()
    const changes: number[] = []
    ctx.on('tools/change', () => changes.push(changes.length))

    const dispose = tools.register(textTool('echo', args => String(args.value)))
    expect(tools.list().map(tool => tool.name)).toEqual(['echo'])
    expect(tools.get('echo')?.description).toBe('echo tool')
    expect(tools.get('missing')).toBeUndefined()

    dispose()
    expect(tools.list()).toEqual([])
    expect(changes).toHaveLength(2)
  })

  it('rejects empty tool names', async () => {
    const { tools } = await mount()
    expect(() => tools.register({ ...textTool('x', () => ''), name: '  ' })).toThrow(/must not be empty/)
  })

  it('executes in input order even when calls finish out of order', async () => {
    const { tools } = await mount()
    tools.register(textTool('wait', async args => {
      await new Promise(resolve => setTimeout(resolve, Number(args.delay)))
      return String(args.value)
    }))

    const results = await tools.execute([
      { name: 'wait', args: { delay: 20, value: 'first' } },
      { name: 'wait', args: { delay: 1, value: 'second' } },
      { name: 'wait', args: { delay: 5, value: 'third' } },
    ], { maxParallel: 3 })

    expect(results.map(result => result.content[0])).toEqual([
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
      { type: 'text', text: 'third' },
    ])
  })

  it('normalizes thrown errors and unknown tools', async () => {
    const { tools } = await mount()
    tools.register(textTool('explode', () => {
      throw new Error('boom')
    }))

    const [failure, unknown] = await tools.execute([
      { name: 'explode', args: {} },
      { name: 'nope', args: {} },
    ])

    expect(failure?.isError).toBe(true)
    expect(failure?.content[0]).toEqual({
      type: 'text',
      text: 'Tool "explode" failed: boom',
    })
    expect(unknown?.isError).toBe(true)
    expect(unknown?.content[0]).toEqual({
      type: 'text',
      text: 'Unknown tool "nope".',
    })
  })

  it('runs pre-execute, execute, and post-execute waterfalls in order', async () => {
    const { ctx, tools } = await mount()
    const stages: string[] = []
    tools.register(textTool('echo', args => {
      stages.push('body')
      return String(args.value)
    }))

    ctx.on('tools/pre-execute', async (_exec, next) => {
      stages.push('pre')
      return next()
    })
    ctx.on('tools/execute', async (_exec, next) => {
      stages.push('wrap-before')
      const result = await next()
      stages.push('wrap-after')
      return result
    })
    ctx.on('tools/post-execute', async (_exec, result, next) => {
      stages.push('post')
      const base = await next()
      return {
        ...base,
        content: [...base.content, { type: 'text' as const, text: 'postscript' }],
      }
    })

    const [result] = await tools.execute([{ name: 'echo', args: { value: 'hi' } }])
    expect(stages).toEqual(['pre', 'wrap-before', 'body', 'wrap-after', 'post'])
    expect(result?.content.map(block => block.type === 'text' ? block.text : '')).toEqual([
      'hi',
      'postscript',
    ])
  })

  it('denies calls when pre-execute resolves false', async () => {
    const { ctx, tools } = await mount()
    let bodyRan = false
    tools.register(textTool('echo', () => {
      bodyRan = true
      return 'hi'
    }))
    ctx.on('tools/pre-execute', async () => false)

    const [result] = await tools.execute([{ name: 'echo', args: {} }])
    expect(bodyRan).toBe(false)
    expect(result?.isError).toBe(true)
    expect(result?.content[0]).toEqual({
      type: 'text',
      text: 'Tool "echo" was denied by policy.',
    })
  })

  it('contains errors thrown by result observers', async () => {
    const { ctx, tools } = await mount()
    tools.register(textTool('echo', () => 'hi'))
    ctx.on('tools/result', () => {
      throw new Error('observer boom')
    })

    const [result] = await tools.execute([{ name: 'echo', args: {} }])
    expect(result).toEqual({ content: [{ type: 'text', text: 'hi' }], isError: false })
  })

  it('scopes tool visibility to the owning agent', async () => {
    const { tools } = await mount()
    const agent = {}
    const other = {}
    tools.register(textTool('echo', () => 'global'))
    tools.register(textTool('private', () => 'scoped'), { scope: agent })

    expect(tools.get('private')).toBeUndefined()
    expect(tools.get('private', agent)?.name).toBe('private')
    expect(tools.list().map(tool => tool.name)).toEqual(['echo'])
    expect(tools.list(agent).map(tool => tool.name).sort()).toEqual(['echo', 'private'])

    const [globalResult, scopedResult, deniedResult] = await tools.execute([
      { name: 'echo', args: {} },
      { name: 'private', args: {}, agent },
      { name: 'private', args: {}, agent: other },
    ])
    expect(globalResult?.isError).toBe(false)
    expect(scopedResult?.isError).toBe(false)
    expect(deniedResult?.isError).toBe(true)
  })

  it('projects definitions onto the model-facing schema', () => {
    const definition = textTool('echo', () => '')
    expect(toToolSchema(definition)).toEqual({
      name: 'echo',
      description: 'echo tool',
      parameters: { type: 'object' },
    })
  })
})

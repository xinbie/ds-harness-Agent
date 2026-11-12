import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { FsService } from '../src/index.ts'
import type { Config, FsProvider } from '../src/index.ts'

function provider(id: string, text: string): FsProvider {
  return {
    id,
    async stat() {
      return { kind: 'file', size: text.length, mtimeMs: 0 }
    },
    async readText() {
      return text
    },
  }
}

async function mount(config: Config = {}): Promise<FsService> {
  const ctx = new Context()
  await ctx.plugin(FsService, config)
  return ctx.fs
}

describe('FsService', () => {
  it('uses the sole registered provider', async () => {
    const fs = await mount()
    fs.registerProvider(provider('local', 'one'))
    expect(await fs.readText('a.txt')).toBe('one')
    expect(fs.provider?.id).toBe('local')
  })

  it('selects a configured provider and rejects ambiguity', async () => {
    const configured = await mount({ provider: 'second' })
    configured.registerProvider(provider('first', 'first'))
    configured.registerProvider(provider('second', 'second'))
    expect(await configured.readText('a.txt')).toBe('second')
    expect(configured.provider?.id).toBe('second')

    const ambiguous = await mount()
    ambiguous.registerProvider(provider('first', 'first'))
    ambiguous.registerProvider(provider('second', 'second'))
    await expect(ambiguous.readText('a.txt')).rejects.toThrow(/multiple fs providers are registered/)
    expect(ambiguous.provider).toBeUndefined()
  })

  it('reports a missing configured provider and no provider at all', async () => {
    const configured = await mount({ provider: 'missing' })
    configured.registerProvider(provider('first', 'first'))
    await expect(configured.readText('a.txt'))
      .rejects.toThrow(/configured fs provider "missing" is not registered/)

    const empty = await mount()
    await expect(empty.readText('a.txt')).rejects.toThrow(/no fs provider is registered/)
  })

  it('rejects empty and duplicate provider ids', async () => {
    const fs = await mount()
    fs.registerProvider(provider('local', 'one'))
    expect(() => fs.registerProvider(provider('local', 'two'))).toThrow(/already registered/)
    expect(() => fs.registerProvider(provider('', 'x'))).toThrow(/id must not be empty/)
  })

  it('emits fs/observed only for reads', async () => {
    const ctx = new Context()
    await ctx.plugin(FsService)
    await ctx.plugin(providerPlugin(provider('local', 'text')))
    const observed: string[] = []
    ctx.on('fs/observed', payload => observed.push(payload.path))

    await ctx.fs.stat('a.txt')
    await ctx.fs.readText('a.txt')
    expect(observed).toEqual(['a.txt'])
  })
})

function providerPlugin(fsProvider: FsProvider): {
  inject: string[]
  apply(ctx: Context): void
} {
  return {
    inject: ['fs'],
    apply(ctx) {
      ctx.fs.registerProvider(fsProvider)
    },
  }
}

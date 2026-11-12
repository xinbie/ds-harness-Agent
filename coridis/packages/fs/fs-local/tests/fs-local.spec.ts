import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FsService } from '@coridis/fs'
import * as fsLocal from '../src/index.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'coridis-fs-'))
  await mkdir(join(root, 'nested'))
  await writeFile(join(root, 'hello.txt'), 'line one\nline two\n', 'utf8')
  await writeFile(join(root, 'nested', 'deep.txt'), 'deep', 'utf8')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function mount(): Promise<FsService> {
  const ctx = new Context()
  await ctx.plugin(FsService)
  await ctx.plugin(fsLocal, { cwd: root })
  return ctx.fs
}

describe('fs-local provider', () => {
  it('reads relative and absolute paths inside the root', async () => {
    const fs = await mount()
    expect(await fs.readText('hello.txt')).toBe('line one\nline two\n')
    expect(await fs.readText('nested/deep.txt')).toBe('deep')
    expect(await fs.readText(join(root, 'nested', 'deep.txt'))).toBe('deep')
  })

  it('stats files and directories', async () => {
    const fs = await mount()
    const file = await fs.stat('hello.txt')
    expect(file.kind).toBe('file')
    expect(file.size).toBe(18)
    expect(file.mtimeMs).toBeGreaterThan(0)

    expect((await fs.stat('nested')).kind).toBe('directory')
  })

  it('rejects lexical escapes from the root', async () => {
    const fs = await mount()
    await expect(fs.readText('../outside.txt')).rejects.toThrow(/outside the workspace root/)
    await expect(fs.readText('/etc/hostname')).rejects.toThrow(/outside the workspace root/)
  })

  it('rejects symlink escapes', async () => {
    const fs = await mount()
    await symlink('/etc/hostname', join(root, 'link.txt'))
    await expect(fs.readText('link.txt')).rejects.toThrow(/escapes the workspace root through a link/)
  })

  it('observes successful reads through the seam', async () => {
    const ctx = new Context()
    await ctx.plugin(FsService)
    await ctx.plugin(fsLocal, { cwd: root })
    const observed: string[] = []
    ctx.on('fs/observed', payload => observed.push(payload.path))

    await ctx.fs.readText('hello.txt')
    expect(observed).toEqual(['hello.txt'])
  })

  it('fails reads through the seam when no provider is registered', async () => {
    const ctx = new Context()
    await ctx.plugin(FsService)
    await expect(ctx.fs.readText('hello.txt')).rejects.toThrow(/no fs provider is registered/)
  })
})

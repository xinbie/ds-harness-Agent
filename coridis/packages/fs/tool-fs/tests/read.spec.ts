import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FsService } from '@coridis/fs'
import * as fsLocal from '@coridis/fs-local'
import * as toolFs from '@coridis/tool-fs'
import { SystemPromptService } from '@coridis/system-prompt'
import { ToolsService } from '@coridis/tools'
import type { ToolExecutionResult } from '@coridis/tools'

let root: string
let ctx: Context

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'coridis-read-'))
  await writeFile(join(root, 'five.txt'), 'one\ntwo\nthree\nfour\nfive\n', 'utf8')
  await writeFile(join(root, 'empty.txt'), '', 'utf8')
  await writeFile(join(root, 'no-newline.txt'), 'a\nb', 'utf8')
  ctx = new Context()
  await ctx.plugin(SystemPromptService)
  await ctx.plugin(ToolsService)
  await ctx.plugin(FsService)
  await ctx.plugin(fsLocal, { cwd: root })
  await ctx.plugin(toolFs, { readLimit: 3 })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function read(args: Readonly<Record<string, unknown>>): Promise<ToolExecutionResult> {
  const [result] = await ctx.tools.execute([{ name: 'read', args }])
  if (result === undefined) throw new Error('read returned no result')
  return result
}

function text(result: ToolExecutionResult): string {
  const block = result.content[0]
  return block?.type === 'text' ? block.text : ''
}

describe('read tool', () => {
  it('numbers lines and caps the window at readLimit', async () => {
    const result = await read({ path: 'five.txt', limit: 100 })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe([
      '1→one',
      '2→two',
      '3→three',
      '',
      '(showing lines 1-3 of 5)',
    ].join('\n'))
  })

  it('honors offset and reports the window', async () => {
    const result = await read({ path: 'five.txt', offset: 2, limit: 2 })
    expect(text(result)).toBe([
      '2→two',
      '3→three',
      '',
      '(showing lines 2-3 of 5)',
    ].join('\n'))
  })

  it('uses the full width of the final line number', async () => {
    const result = await read({ path: 'five.txt', offset: 3, limit: 3 })
    expect(text(result)).toContain('3→three')
    expect(text(result)).toContain('5→five')
  })

  it('does not add a footer when the whole file is shown', async () => {
    const result = await read({ path: 'no-newline.txt' })
    expect(text(result)).toBe('1→a\n2→b')
  })

  it('handles empty files and offsets past the end', async () => {
    expect(text(await read({ path: 'empty.txt' }))).toBe('(file "empty.txt" is empty)')
    expect(text(await read({ path: 'five.txt', offset: 99 })))
      .toBe('(file "five.txt" has 5 lines; offset 99 is past the end)')
  })

  it('rejects directories, escapes, and invalid arguments', async () => {
    const directory = await read({ path: '.' })
    expect(directory.isError).toBe(true)
    expect(text(directory)).toContain('is a directory, not a file')

    const escape = await read({ path: '../outside.txt' })
    expect(escape.isError).toBe(true)
    expect(text(escape)).toContain('outside the workspace root')

    const invalid = await read({ path: 'five.txt', limit: 0 })
    expect(invalid.isError).toBe(true)
    expect(text(invalid)).toContain('"limit" must be a positive integer')

    const missing = await read({})
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('"path" must be a non-empty string')
  })

  it('contributes read guidance to the system prompt', async () => {
    const assembly = await ctx.systemPrompt.assemble({})
    expect(assembly.system).toContain('`read` tool')
    expect(assembly.system).toContain('Read at most 3 lines per call')
    expect(ctx.tools.get('read')?.name).toBe('read')
  })
})

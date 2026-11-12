/**
 * Model-facing file tools over `ctx.fs`; this minimal harness registers `read` only.
 * This package owns the schema, argument validation, line windowing, and
 * prompt guidance, never a concrete provider.
 *
 * @module @coridis/tool-fs
 */

import type { Context } from '@deepseek-ai/cordis'
import { SECTION_ORDER } from '@coridis/system-prompt'
import type {} from '@coridis/tools'
import { defineTool } from '@coridis/tools'
import type {} from '@coridis/fs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-fs'

/** Services required by the file tool suite. */
export const inject = ['tools', 'fs', 'systemPrompt']

/** Plugin configuration. */
export interface Config {
  /** Register `read`. Defaults to true. */
  readonly read?: boolean
  /** Default and maximum number of lines returned by one call. */
  readonly readLimit?: number
}

/** Contribute file guidance and the `read` tool. */
export function apply(ctx: Context, config: Config = {}): void {
  const readLimit = Math.max(1, Math.floor(config.readLimit ?? 2000))
  if (config.read ?? true) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: 'tools/fs',
      order: SECTION_ORDER.tools,
      text: [
        'You have a `read` tool for local text files.',
        'Use it instead of guessing file contents. Paths are relative to the workspace root.',
        `Read at most ${readLimit} lines per call; use offset and limit for large files.`,
        'Output is line-numbered.',
      ].join(' '),
    }))
    ctx.effect(() => ctx.tools.register(createReadTool(ctx, readLimit)))
  }
}

function createReadTool(ctx: Context, readLimit: number) {
  return defineTool({
    name: 'read',
    description: 'Read a text file from the workspace. Output is line-numbered.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path, relative to the workspace root or absolute inside it.',
        },
        offset: {
          type: 'integer',
          minimum: 1,
          description: '1-based line to start reading from. Defaults to 1.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          description: `Maximum number of lines to return. Defaults to and is capped at ${readLimit}.`,
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(args) {
      const path = requireString(args, 'path')
      const offset = optionalPositiveInteger(args, 'offset') ?? 1
      const limit = Math.min(optionalPositiveInteger(args, 'limit') ?? readLimit, readLimit)

      const info = await ctx.fs.stat(path)
      if (info.kind === 'directory') {
        throw new Error(`"${path}" is a directory, not a file`)
      }

      const text = await ctx.fs.readText(path)
      const lines = text === '' ? [] : text.split(/\r?\n/)
      if (text.endsWith('\n')) lines.pop()

      if (lines.length === 0) {
        return { content: [{ type: 'text', text: `(file "${path}" is empty)` }] }
      }
      if (offset > lines.length) {
        return {
          content: [{
            type: 'text',
            text: `(file "${path}" has ${lines.length} lines; offset ${offset} is past the end)`,
          }],
        }
      }

      const start = offset - 1
      const end = Math.min(lines.length, start + limit)
      const width = String(end).length
      const rendered = lines
        .slice(start, end)
        .map((line, index) => `${String(start + index + 1).padStart(width)}→${line}`)
        .join('\n')
      const footer = end - start < lines.length || start > 0
        ? `\n\n(showing lines ${start + 1}-${end} of ${lines.length})`
        : ''
      return { content: [{ type: 'text', text: `${rendered}${footer}` }] }
    },
  })
}

function requireString(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`"${key}" must be a non-empty string`)
  }
  return value
}

function optionalPositiveInteger(
  args: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = args[key]
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`"${key}" must be a positive integer`)
  }
  return value
}

/**
 * Local-filesystem provider for `ctx.fs`. It is the only package in the fs
 * domain that may import Node's `node:fs`; consumers see the seam only.
 *
 * @module @coridis/fs-local
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FsProvider, FsStat } from '@coridis/fs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'fs-local'

/** The seam this provider registers into. */
export const inject = ['fs']

/** Provider configuration. */
export interface Config {
  /** Root that relative paths resolve against. Defaults to `process.cwd()`. */
  readonly cwd?: string
  /** Provider id. Defaults to `local`. */
  readonly id?: string
}

/** Register a local-disk provider confined to the configured root. */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = createProvider(config)
  ctx.effect(() => ctx.fs.registerProvider(provider), 'fs-local.provide')
}

function createProvider(config: Config): FsProvider {
  const id = config.id ?? 'local'
  const root = resolve(config.cwd ?? process.cwd())

  const confine = (path: string): string => {
    const target = resolve(root, path)
    if (!inside(root, target)) {
      throw new Error(`path "${path}" is outside the workspace root`)
    }
    return target
  }

  return {
    id,
    async stat(path: string): Promise<FsStat> {
      const info = await stat(confine(path))
      return {
        kind: info.isDirectory() ? 'directory' : 'file',
        size: info.size,
        mtimeMs: info.mtimeMs,
      }
    },
    async readText(path: string): Promise<string> {
      const target = confine(path)
      const actualRoot = await realpath(root).catch(() => root)
      const actual = await realpath(target)
      if (!inside(actualRoot, actual)) {
        throw new Error(`path "${path}" escapes the workspace root through a link`)
      }
      return readFile(actual, 'utf8')
    },
  }
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

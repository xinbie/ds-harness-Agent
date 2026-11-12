/**
 * Profile and bundle composition. A running coridis is a Cordis plugin tree
 * assembled from ordered patch layers: the profile's bundles, then the user's
 * own patch file. This package resolves those layers and boots the Context.
 *
 * The composer is deliberately small and deterministic. It reads YAML, folds
 * the layers into one row list, resolves every plugin name relative to the
 * bundle that contributed it, and mounts the rows in order. There is no live
 * config file watcher in this minimal harness.
 *
 * @module @coridis/app-boot
 */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber, Plugin } from '@deepseek-ai/cordis'
import { load } from 'js-yaml'

/** A startup failure that the CLI renders as a diagnostic instead of a stack. */
export class StartupError extends Error {
  override readonly name = 'StartupError'
}

/** A profile is an ordered list of bundles. */
export interface ProfileManifest {
  readonly bundles: readonly string[]
}

/** One plugin row in the composed entry list. */
export interface PatchRow {
  readonly id: string
  readonly name: string
  readonly config?: unknown
  readonly inject?: readonly string[]
  readonly disabled?: boolean
}

/** A patch layer expressed in memory instead of a file. */
export interface PatchLayer {
  readonly insert?: readonly PatchRow[]
  readonly updates?: readonly PatchUpdate[]
  readonly remove?: readonly string[]
}

/** An in-memory row update addressed by row id. */
export interface PatchUpdate {
  readonly id: string
  readonly name?: string
  readonly config?: unknown
  readonly inject?: readonly string[]
  readonly disabled?: boolean
}

/** Inputs for booting one profile. */
export interface BootOptions {
  /** Profile directory containing `profile.yml`. */
  readonly profileDir: string
  /** Harness home; defaults to the implementation's user data directory. */
  readonly home?: string
  /** Extra patch files, applied after the profile's own layers. */
  readonly patches?: readonly string[]
  /**
   * File to resolve bundle and inline plugin names from. The CLI passes its
   * own package file, because a bare profile directory has no dependencies.
   */
  readonly resolveFrom?: string
  /** In-memory layers, applied last (typically CLI startup overrides). */
  readonly layers?: readonly PatchLayer[]
}

/** A live Context plus the ordered teardown of everything it mounted. */
export interface BootedProfile {
  readonly ctx: Context
  readonly profile: ProfileManifest
  dispose(): Promise<void>
}

interface ComposedRow {
  readonly row: PatchRow
  readonly anchor: string
}

interface BundleLayer {
  readonly name: string
  readonly packageFile: string
  readonly patchFile: string
}

/** Read and validate `profile.yml`. */
export async function readProfile(profileDir: string): Promise<ProfileManifest> {
  const file = join(profileDir, 'profile.yml')
  let source: string
  try {
    source = await readFile(file, 'utf8')
  } catch (error) {
    throw new StartupError(`cannot read profile ${file}: ${describe(error)}`)
  }
  let document: unknown
  try {
    document = load(source)
  } catch (error) {
    throw new StartupError(`cannot parse profile ${file}: ${describe(error)}`)
  }
  if (!isRecord(document) || !Array.isArray(document.bundles)) {
    throw new StartupError(`profile ${file} must declare a "bundles" array`)
  }
  const bundles: string[] = []
  for (const bundle of document.bundles) {
    if (typeof bundle !== 'string' || bundle.trim() === '') {
      throw new StartupError(`profile ${file} has a bundle name that is not a non-empty string`)
    }
    bundles.push(bundle)
  }
  if (bundles.length === 0) {
    throw new StartupError(`profile ${file} mounts no bundles`)
  }
  return { bundles }
}

/** Compose bundle patches, resolve rows, and mount them on a fresh Context. */
export async function bootProfile(options: BootOptions): Promise<BootedProfile> {
  const profile = await readProfile(options.profileDir)
  const anchor = resolveAnchor(options)
  const rows = await compose(options, profile, anchor)

  const ctx = new Context()
  const fibers: Fiber[] = []
  try {
    for (const entry of rows) {
      if (entry.row.disabled === true) continue
      const plugin = await importPlugin(entry)
      fibers.push(await mount(ctx, plugin, entry.row))
    }
  } catch (error) {
    await disposeAll(fibers)
    if (error instanceof StartupError) throw error
    throw new StartupError(`failed to boot profile: ${describe(error)}`)
  }

  let disposed: Promise<void> | undefined
  return {
    ctx,
    profile,
    dispose() {
      disposed ??= disposeAll(fibers)
      return disposed
    },
  }
}

async function compose(
  options: BootOptions,
  profile: ProfileManifest,
  anchor: string,
): Promise<ComposedRow[]> {
  const rows = new Map<string, ComposedRow>()
  const order: string[] = []

  const apply = (layer: PatchLayer, layerAnchor: string, source: string): void => {
    for (const row of layer.insert ?? []) {
      if (rows.has(row.id)) {
        throw new StartupError(`${source} inserts duplicate row id "${row.id}"`)
      }
      rows.set(row.id, { row, anchor: layerAnchor })
      order.push(row.id)
    }
    for (const update of layer.updates ?? []) {
      const existing = rows.get(update.id)
      if (existing === undefined) {
        throw new StartupError(`${source} updates unknown row id "${update.id}"`)
      }
      rows.set(update.id, {
        row: mergeRow(existing.row, update),
        anchor: update.name === undefined ? existing.anchor : layerAnchor,
      })
    }
    for (const id of layer.remove ?? []) {
      if (!rows.delete(id)) {
        throw new StartupError(`${source} removes unknown row id "${id}"`)
      }
      order.splice(order.indexOf(id), 1)
    }
  }

  for (const bundleName of profile.bundles) {
    const bundle = resolveBundle(bundleName, anchor)
    apply(await readPatchFile(bundle.patchFile), bundle.packageFile, bundle.patchFile)
  }

  for (const file of options.patches ?? []) {
    const patchFile = isAbsolute(file) ? file : resolve(process.cwd(), file)
    apply(await readPatchFile(patchFile), patchFile, patchFile)
  }

  for (const [index, layer] of (options.layers ?? []).entries()) {
    apply(layer, anchor, `inline layer ${index + 1}`)
  }

  return order.map(id => {
    const entry = rows.get(id)
    if (entry === undefined) throw new StartupError(`row "${id}" disappeared during composition`)
    return entry
  })
}

function mergeRow(row: PatchRow, update: PatchUpdate): PatchRow {
  return {
    id: row.id,
    name: update.name ?? row.name,
    ...(hasConfig(update) ? { config: update.config } : hasConfig(row) ? { config: row.config } : {}),
    ...(update.inject !== undefined
      ? { inject: update.inject }
      : row.inject !== undefined
        ? { inject: row.inject }
        : {}),
    ...(update.disabled !== undefined
      ? { disabled: update.disabled }
      : row.disabled !== undefined
        ? { disabled: row.disabled }
        : {}),
  }
}

function hasConfig(value: { readonly config?: unknown }): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'config')
}

function resolveAnchor(options: BootOptions): string {
  if (options.resolveFrom !== undefined) return resolve(options.resolveFrom)
  return join(resolve(options.profileDir), 'package.json')
}

function resolveBundle(name: string, anchor: string): BundleLayer {
  const require = createRequire(anchor)
  let packageFile: string
  try {
    packageFile = require.resolve(`${name}/package.json`)
  } catch {
    try {
      packageFile = findPackageFile(require.resolve(name))
    } catch (error) {
      throw new StartupError(`cannot resolve bundle "${name}": ${describe(error)}`)
    }
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSyncUtf8(packageFile))
  } catch (error) {
    throw new StartupError(`cannot read bundle manifest ${packageFile}: ${describe(error)}`)
  }
  if (!isRecord(manifest)) {
    throw new StartupError(`bundle manifest ${packageFile} is not an object`)
  }
  const bundle = isRecord(manifest.coridis) && isRecord(manifest.coridis.bundle)
    ? manifest.coridis.bundle
    : undefined
  const patch = bundle?.patch
  if (typeof patch !== 'string' || patch === '') {
    throw new StartupError(`bundle "${name}" does not declare coridis.bundle.patch`)
  }
  return {
    name,
    packageFile,
    patchFile: resolve(dirname(packageFile), patch),
  }
}

function findPackageFile(entry: string): string {
  let directory = dirname(entry)
  while (true) {
    const candidate = join(directory, 'package.json')
    try {
      readFileSyncUtf8(candidate)
      return candidate
    } catch {
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  throw new StartupError(`cannot locate package.json for ${entry}`)
}

function readFileSyncUtf8(file: string): string {
  return readFileSync(file, 'utf8')
}

async function readPatchFile(file: string): Promise<PatchLayer> {
  let source: string
  try {
    source = await readFile(file, 'utf8')
  } catch (error) {
    throw new StartupError(`cannot read patch ${file}: ${describe(error)}`)
  }
  let document: unknown
  try {
    document = load(source)
  } catch (error) {
    throw new StartupError(`cannot parse patch ${file}: ${describe(error)}`)
  }
  return parsePatch(document, file)
}

function parsePatch(document: unknown, source: string): PatchLayer {
  const operations = Array.isArray(document)
    ? document
    : isRecord(document) && 'insert' in document
      ? [document]
      : undefined
  if (operations === undefined) {
    throw new StartupError(`patch ${source} must be a list of operations`)
  }

  const layer: { insert: PatchRow[]; updates: PatchUpdate[]; remove: string[] } = {
    insert: [],
    updates: [],
    remove: [],
  }

  for (const raw of operations) {
    if (!isRecord(raw)) {
      throw new StartupError(`patch ${source} contains a non-object operation`)
    }
    if ('insert' in raw) {
      if (!Array.isArray(raw.insert)) {
        throw new StartupError(`patch ${source} has an "insert" that is not a list`)
      }
      for (const row of raw.insert) layer.insert.push(parseRow(row, source))
      continue
    }
    if ('remove' in raw) {
      if (typeof raw.remove !== 'string') {
        throw new StartupError(`patch ${source} has a "remove" that is not a string`)
      }
      layer.remove.push(raw.remove)
      continue
    }
    if (typeof raw.id !== 'string') {
      throw new StartupError(`patch ${source} has an operation without an "id"`)
    }
    layer.updates.push(parseUpdate(raw, source))
  }

  return layer
}

function parseRow(raw: unknown, source: string): PatchRow {
  if (!isRecord(raw)) {
    throw new StartupError(`patch ${source} contains a non-object row`)
  }
  if (typeof raw.id !== 'string' || raw.id === '') {
    throw new StartupError(`patch ${source} has a row without an "id"`)
  }
  if (typeof raw.name !== 'string' || raw.name === '') {
    throw new StartupError(`patch ${source} row "${raw.id}" has no "name"`)
  }
  return {
    id: raw.id,
    name: raw.name,
    ...(hasConfig(raw) ? { config: raw.config } : {}),
    ...(raw.inject === undefined ? {} : { inject: parseInject(raw.inject, source, raw.id) }),
    ...(raw.disabled === undefined ? {} : { disabled: parseBoolean(raw.disabled, source, raw.id) }),
  }
}

function parseUpdate(raw: Record<string, unknown>, source: string): PatchUpdate {
  const id = raw.id as string
  return {
    id,
    ...(raw.name === undefined ? {} : { name: parseString(raw.name, source, id, 'name') }),
    ...(hasConfig(raw) ? { config: raw.config } : {}),
    ...(raw.inject === undefined ? {} : { inject: parseInject(raw.inject, source, id) }),
    ...(raw.disabled === undefined ? {} : { disabled: parseBoolean(raw.disabled, source, id) }),
  }
}

function parseInject(value: unknown, source: string, id: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new StartupError(`patch ${source} row "${id}" has an invalid "inject"`)
  }
  return value as string[]
}

function parseBoolean(value: unknown, source: string, id: string): boolean {
  if (typeof value !== 'boolean') {
    throw new StartupError(`patch ${source} row "${id}" has an invalid "disabled"`)
  }
  return value
}

function parseString(value: unknown, source: string, id: string, key: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new StartupError(`patch ${source} row "${id}" has an invalid "${key}"`)
  }
  return value
}

async function importPlugin(entry: ComposedRow): Promise<Plugin> {
  const require = createRequire(entry.anchor)
  let target = entry.row.name
  if (target.startsWith('file:')) {
    target = fileURLToPath(target)
  } else if (!isAbsolute(target)) {
    target = require.resolve(target)
  }
  const module = await import(pathToFileURL(target).href) as { default?: unknown }
  const plugin = module.default ?? module
  if (typeof plugin !== 'function' && !isRecord(plugin)) {
    throw new StartupError(`plugin "${entry.row.name}" did not export a plugin`)
  }
  return plugin as Plugin
}

async function mount(ctx: Context, plugin: Plugin, row: PatchRow): Promise<Fiber> {
  const config = row.config
  if (row.inject !== undefined && row.inject.length > 0) {
    return await ctx.inject(row.inject, scoped => scoped.plugin(plugin, config))
  }
  return await ctx.plugin(plugin, config)
}

async function disposeAll(fibers: readonly Fiber[]): Promise<void> {
  for (const fiber of [...fibers].reverse()) {
    try {
      await fiber.dispose()
    } catch {
      // Teardown is best-effort; all fibers are still visited.
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

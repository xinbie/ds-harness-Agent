import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bootProfile, readProfile, StartupError } from '../src/index.ts'
import type { BootOptions } from '../src/index.ts'

interface Fixture {
  readonly root: string
  readonly profileDir: string
  readonly resolveFrom: string
  options(extra?: Partial<BootOptions>): BootOptions
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'coridis-boot-'))
  const bundleDir = join(root, 'node_modules', '@fixture', 'bundle')
  const profileDir = join(root, 'profiles', 'basic')
  await mkdir(bundleDir, { recursive: true })
  await mkdir(profileDir, { recursive: true })

  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture-root', private: true }))
  await writeFile(join(bundleDir, 'package.json'), JSON.stringify({
    name: '@fixture/bundle',
    version: '0.0.0',
    type: 'module',
    coridis: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  await writeFile(join(bundleDir, 'cordis.patch.yml'), [
    'insert:',
    '  - id: fixture',
    '    name: ./plugin.mjs',
    '    config:',
    '      text: base',
    '',
  ].join('\n'))
  await writeFile(join(bundleDir, 'plugin.mjs'), [
    "export const name = 'fixture-plugin'",
    'export function apply(ctx, config = {}) {',
    "  ctx.provide('fixtureService', { text: config.text ?? '' })",
    '}',
    '',
  ].join('\n'))
  await writeFile(join(profileDir, 'profile.yml'), 'bundles:\n  - "@fixture/bundle"\n')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function fixture(): Fixture {
  const resolveFrom = join(root, 'package.json')
  const profileDir = join(root, 'profiles', 'basic')
  return {
    root,
    profileDir,
    resolveFrom,
    options: extra => ({ profileDir, resolveFrom, ...extra }),
  }
}

function service(ctx: unknown): { text: string } | undefined {
  return (ctx as { fixtureService?: { text: string } }).fixtureService
}

describe('readProfile', () => {
  it('reads bundle names in order', async () => {
    const { profileDir } = fixture()
    await writeFile(join(profileDir, 'profile.yml'), 'bundles:\n  - one\n  - two\n')
    expect(await readProfile(profileDir)).toEqual({ bundles: ['one', 'two'] })
  })

  it('rejects missing, malformed, and empty profiles', async () => {
    const { profileDir } = fixture()
    await expect(readProfile(join(root, 'missing')))
      .rejects.toThrow(/cannot read profile/)

    await writeFile(join(profileDir, 'profile.yml'), 'bundles: [unclosed\n')
    await expect(readProfile(profileDir)).rejects.toThrow(/cannot parse profile/)

    await writeFile(join(profileDir, 'profile.yml'), 'bundles: nope\n')
    await expect(readProfile(profileDir)).rejects.toThrow(/must declare a "bundles" array/)

    await writeFile(join(profileDir, 'profile.yml'), 'bundles:\n  - ""\n')
    await expect(readProfile(profileDir)).rejects.toThrow(/not a non-empty string/)

    await writeFile(join(profileDir, 'profile.yml'), 'bundles: []\n')
    await expect(readProfile(profileDir)).rejects.toThrow(/mounts no bundles/)
  })
})

describe('bootProfile', () => {
  it('resolves a bundle, mounts its patch, and disposes the tree', async () => {
    const f = fixture()
    const booted = await bootProfile(f.options())
    expect(booted.profile).toEqual({ bundles: ['@fixture/bundle'] })
    expect(service(booted.ctx)).toEqual({ text: 'base' })

    await booted.dispose()
    expect(service(booted.ctx)).toBeUndefined()
    await booted.dispose()
  })

  it('applies patch files and inline layers in order', async () => {
    const f = fixture()
    const patchFile = join(root, 'extra.yml')
    await writeFile(patchFile, [
      '- id: fixture',
      '  config:',
      '    text: patched',
      '',
    ].join('\n'))

    const booted = await bootProfile(f.options({
      patches: [patchFile],
      layers: [{ updates: [{ id: 'fixture', config: { text: 'inline' } }] }],
    }))
    expect(service(booted.ctx)).toEqual({ text: 'inline' })
  })

  it('honors a disabled row without mounting it', async () => {
    const f = fixture()
    const booted = await bootProfile(f.options({
      layers: [{ updates: [{ id: 'fixture', disabled: true }] }],
    }))
    expect(service(booted.ctx)).toBeUndefined()
    await booted.dispose()
  })

  it('removes rows from an earlier layer', async () => {
    const f = fixture()
    const booted = await bootProfile(f.options({
      layers: [{ remove: ['fixture'] }],
    }))
    expect(service(booted.ctx)).toBeUndefined()
    await booted.dispose()
  })

  it('rejects duplicate inserts, unknown updates, and unknown removes', async () => {
    const f = fixture()
    await expect(bootProfile(f.options({
      layers: [{ insert: [{ id: 'fixture', name: './plugin.mjs' }] }],
    }))).rejects.toThrow(/inserts duplicate row id "fixture"/)

    await expect(bootProfile(f.options({
      layers: [{ updates: [{ id: 'missing', config: {} }] }],
    }))).rejects.toThrow(/updates unknown row id "missing"/)

    await expect(bootProfile(f.options({
      layers: [{ remove: ['missing'] }],
    }))).rejects.toThrow(/removes unknown row id "missing"/)
  })

  it('reports unknown bundles and malformed patch files as startup errors', async () => {
    const f = fixture()
    const badProfile = join(root, 'profiles', 'bad')
    await mkdir(badProfile, { recursive: true })
    await writeFile(join(badProfile, 'profile.yml'), 'bundles:\n  - "@fixture/missing"\n')
    await expect(bootProfile({ profileDir: badProfile, resolveFrom: f.resolveFrom }))
      .rejects.toBeInstanceOf(StartupError)

    const badPatch = join(root, 'bad.yml')
    await writeFile(badPatch, 'just a string\n')
    await expect(bootProfile(f.options({ patches: [badPatch] })))
      .rejects.toThrow(/must be a list of operations/)
  })
})

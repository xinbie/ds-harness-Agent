import { describe, expect, it } from 'vitest'
import { isScopeVisible, ScopeLayer, scopeOf, scopeTarget } from '../src/index.ts'

describe('scopeTarget', () => {
  it('carries the scope key on a receiver-like object', () => {
    const agent = {}
    expect(scopeOf(scopeTarget(agent))).toBe(agent)
    expect(scopeOf(scopeTarget())).toBeUndefined()
    expect(scopeOf(undefined)).toBeUndefined()
    expect(scopeOf('text')).toBeUndefined()
  })

  it('treats global contributions as visible from every scope', () => {
    const agent = {}
    expect(isScopeVisible(undefined)).toBe(true)
    expect(isScopeVisible(undefined, agent)).toBe(true)
    expect(isScopeVisible(agent, agent)).toBe(true)
    expect(isScopeVisible(agent, {})).toBe(false)
    expect(isScopeVisible(agent)).toBe(false)
  })
})

describe('ScopeLayer', () => {
  it('prefers scoped entries, shadows same-named globals, and unwinds', () => {
    const layer = new ScopeLayer<string>()
    const agent = {}
    const other = {}

    const disposeGlobal = layer.register('tool', 'global')
    const disposeScoped = layer.register('tool', 'scoped', agent)

    expect(layer.get('tool')).toBe('global')
    expect(layer.get('tool', agent)).toBe('scoped')
    expect(layer.get('tool', other)).toBe('global')
    expect(layer.list(agent).sort()).toEqual(['scoped'])
    expect(layer.list(other)).toEqual(['global'])

    disposeScoped()
    expect(layer.get('tool', agent)).toBe('global')

    disposeGlobal()
    expect(layer.get('tool')).toBeUndefined()
    expect(layer.isEmpty()).toBe(true)
  })

  it('keeps the newest registration in a layer and ignores stale disposers', () => {
    const layer = new ScopeLayer<number>()
    const first = layer.register('value', 1)
    const second = layer.register('value', 2)

    expect(layer.get('value')).toBe(2)
    first()
    expect(layer.get('value')).toBe(2)
    second()
    expect(layer.get('value')).toBeUndefined()
  })
})

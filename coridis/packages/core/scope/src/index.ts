/**
 * Agent-scoped registration primitive. A contribution is either global or
 * owned by exactly one scope key — by convention, the live `Agent` object.
 * Scoped registrations are visible only inside that scope and unwind with it.
 *
 * This package is a library, not a plugin: it owns no `ctx.<key>` service.
 *
 * @module @coridis/scope
 */

import type { Context } from '@deepseek-ai/cordis'

/** Opaque identity of a scope. Compared by object identity. */
export type ScopeKey = object

/** A value tagged with the scope that owns it; an absent key means global. */
export interface Scoped<T> {
  readonly value: T
  readonly key?: ScopeKey
}

const scopeSymbol = Symbol.for('coridis.scope')

/**
 * Build the `thisArg` for a scope-filtered dispatch: listeners tagged with the
 * subject's scope plus untagged global listeners are admitted.
 *
 * The carrier is intentionally a plain object, not a live Cordis context:
 * scoped dispatch must not acquire services or effects. Cordis treats an
 * untagged receiver as global, so the carrier keeps the key readable while the
 * owning service applies its own visibility rules.
 *
 * @param key - the subject scope, or `undefined` for a subject-less dispatch.
 */
export function scopeTarget(key?: ScopeKey): Context {
  return { [scopeSymbol]: key } as unknown as Context
}

/** Read the scope key carried by a dispatch receiver, if any. */
export function scopeOf(target: unknown): ScopeKey | undefined {
  if (typeof target !== 'object' || target === null) return
  const key = (target as { [scopeSymbol]?: unknown })[scopeSymbol]
  return typeof key === 'object' && key !== null ? key : undefined
}

/** True when a contribution owned by `owner` is visible from `scope`. */
export function isScopeVisible(owner: ScopeKey | undefined, scope?: ScopeKey): boolean {
  return owner === undefined || owner === scope
}

/**
 * Layered registration table: global entries are visible everywhere, scoped
 * entries only from their own scope, and a scoped entry shadows a global one
 * with the same name. The most recently registered entry wins inside a layer.
 */
export class ScopeLayer<T> {
  private readonly global = new Map<string, T>()
  private readonly scoped = new Map<ScopeKey, Map<string, T>>()

  /** Register one entry and return its disposer. */
  register(key: string, value: T, scope?: ScopeKey): () => void {
    const table = scope === undefined
      ? this.global
      : getOrCreate(this.scoped, scope)
    table.set(key, value)
    return () => {
      if (table.get(key) !== value) return
      table.delete(key)
      if (table !== this.global && table.size === 0) this.scoped.delete(scope!)
    }
  }

  /** Resolve one visible entry, preferring the scope's own layer. */
  get(key: string, scope?: ScopeKey): T | undefined {
    if (scope !== undefined) {
      const value = this.scoped.get(scope)?.get(key)
      if (value !== undefined) return value
    }
    return this.global.get(key)
  }

  /** List visible entries; scoped entries shadow same-named globals. */
  list(scope?: ScopeKey): T[] {
    const result = new Map<string, T>(this.global)
    if (scope !== undefined) {
      for (const [key, value] of this.scoped.get(scope) ?? []) result.set(key, value)
    }
    return [...result.values()]
  }

  /** True when no global or scoped entry is registered. */
  isEmpty(): boolean {
    return this.global.size === 0 && this.scoped.size === 0
  }
}

function getOrCreate<V>(map: Map<ScopeKey, Map<string, V>>, key: ScopeKey): Map<string, V> {
  let value = map.get(key)
  if (value === undefined) {
    value = new Map<string, V>()
    map.set(key, value)
  }
  return value
}

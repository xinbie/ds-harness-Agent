/**
 * Filesystem capability contract shared by providers and tool consumers.
 *
 * @module @coridis/fs
 */

/** Metadata needed to route a read and render a bounded window. */
export interface FsStat {
  readonly kind: 'file' | 'directory'
  readonly size: number
  readonly mtimeMs: number
}

/** Text encoding accepted by the read path. */
export type FsEncoding = 'utf8'

/** One filesystem backend. */
export interface FsProvider {
  readonly id: string
  /** Stat a path in the provider's execution world. */
  stat(path: string): Promise<FsStat>
  /** Read a text file, resolved and confined by the provider. */
  readText(path: string, options?: { readonly encoding?: FsEncoding }): Promise<string>
}

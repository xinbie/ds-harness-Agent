/**
 * Web access capability contract shared by search/fetch providers and the
 * model-facing tools.
 *
 * @module @coridis/web
 */

/** One search hit. */
export interface WebSearchSource {
  readonly title: string
  readonly url: string
  readonly snippet?: string
}

/** One search request. */
export interface WebSearchRequest {
  readonly query: string
  readonly maxResults?: number
  readonly signal?: AbortSignal
}

/** Search outcome. */
export interface WebSearchResult {
  readonly sources: readonly WebSearchSource[]
}

/** One fetch request. */
export interface WebFetchRequest {
  readonly url: string
  readonly signal?: AbortSignal
}

/** Fetched page converted to readable text. */
export interface WebFetchResult {
  readonly url: string
  readonly title?: string
  readonly text: string
}

/** Search provider contract. */
export interface WebSearchProvider {
  readonly id: string
  search(request: WebSearchRequest): Promise<WebSearchResult>
}

/** Fetch provider contract. */
export interface WebFetchProvider {
  readonly id: string
  fetch(request: WebFetchRequest): Promise<WebFetchResult>
}

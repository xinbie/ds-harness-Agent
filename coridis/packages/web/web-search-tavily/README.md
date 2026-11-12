# @coridis/web-search-tavily

Tavily search provider for ctx.web.

**Status: implemented.** Behavior is covered by specs in `tests/` under this package.

## Role

Provider for `ctx.web`. It POSTs the neutral query to Tavily `/search`, maps title/url/content
results to sources, and reads its key from `TAVILY_API_KEY` at request time.

## See also

- [architecture](../../../docs/architecture.md)
- [capability seams](../../../docs/capability-seams.md)

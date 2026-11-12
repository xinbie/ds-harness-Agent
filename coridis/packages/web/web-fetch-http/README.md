# @coridis/web-fetch-http

Plain HTTP fetch provider for ctx.web.

**Status: implemented.** Behavior is covered by specs in `tests/` under this package.

## Role

Provider for `ctx.web`. It fetches http(s) URLs with redirects, a timeout, and abort
propagation; converts HTML to plain text (title, stripped scripts/styles, decoded entities);
and caps output. Non-HTML bodies pass through unchanged.

## See also

- [architecture](../../../docs/architecture.md)
- [capability seams](../../../docs/capability-seams.md)

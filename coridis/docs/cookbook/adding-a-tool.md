# Cookbook: adding a model-facing tool

A tool is a **Consumer** of one or more seams. It owns the model-facing schema, validation, limits,
and presentation; it must not implement the underlying capability itself.

## 1. Decide the seam

| Tool need | Inject | Never do |
|---|---|---|
| Read or write files | `fs` | `import { readFile } from 'node:fs/promises'` |
| Search or fetch the web | `web` | call `fetch()` in the tool body |
| Call another model | `llm` | embed a vendor SDK |

If no seam exists, add one first ([capability-seams.md](../capability-seams.md)).

## 2. Add the tool to a `tool-*` package

Prefer extending an existing family (`tool-fs`, `tool-web`) when the concern is the same. Create a
new `tool-*` package when the capability, config, and lifecycle are independent.

```ts
export const name = 'tool-example'
export const inject = ['tools', 'example', 'systemPrompt']

export interface Config {
  /** Register the tool. Defaults to true. */
  readonly enabled?: boolean
}

export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return

  ctx.systemPrompt.section({
    name: 'tool:example',
    order: 100,
    text: 'Use the example tool for ...',
  })

  ctx.tools.register(defineTool({
    name: 'example',
    description: '...',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(args, execution) {
      const result = await ctx.example.run(String(args.query), { signal: execution.signal })
      return { content: [{ type: 'text', text: result }] }
    },
  }))
}
```

## 3. Rules implementations keep

- **Schema and body agree.** Names, required fields, and defaults in `parameters` must match the
  parser; extra fields are rejected.
- **Cancellation is cooperative.** Pass `execution.signal` through the seam and stop on abort.
- **Errors are structured.** Return `{ isError: true }` with a typed code in the text, not a raw
  stack trace.
- **Output is bounded.** Cap lines/chars/bytes and say when output was truncated.
- **Prompt guidance is conditional.** A section for a disabled or unadmitted tool must render empty.
- **No provider selection.** Delegate to the service; selection and its errors belong to the seam.
- **One tool, one job.** Do not add `read` behavior to `web_fetch` or vice versa.

## 4. Register it

Add the tool package (if new) to `tsconfig.host.json`, the base `paths` map, the dependent's
`tsconfig.json`, and the relevant bundle patch. Add a `Config` row with defaults.

## 5. Test it

Mount a Cordis context with a **fake** provider, register the tool, and call it through
`ctx.tools.execute`. Assert the rendered text, the error shape, and the prompt section presence.
Do not reach into the tool's private functions; test the contract the model sees.

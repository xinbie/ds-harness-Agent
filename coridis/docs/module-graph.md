# Module graph

Arrows point from consumer to the package it imports. Every internal import is an `"*"`
dependency (linked by the npm workspace) and a matching tsconfig project reference.

```mermaid
graph TD
  cli[apps/cli] --> appboot[boot/app-boot]
  cli --> base[bundle/base]
  cli --> headless[bundle/headless]

  headless --> agent[core/agent]
  headless --> agentloop[core/agent-loop]
  headless --> llm[llm/llm]
  headless --> session[core/session]
  headless --> fs[fs/fs]

  agentloop --> agent
  agentloop --> session
  agentloop --> tools[core/tools]
  agentloop --> prompt[core/system-prompt]
  agentloop --> llm
  agentloop --> scope[core/scope]

  agent --> scope
  agent --> session
  agent --> tools
  agent --> llm
  agent --> prompt

  tools --> scope
  tools --> session
  tools --> prompt
  tools --> llm

  prompt --> llm
  prompt --> scope

  toolfs[fs/tool-fs] --> tools
  toolfs --> fs
  toolfs --> prompt
  toolfs --> scope
  fslocal[fs/fs-local] --> fs

  toolweb[web/tool-web] --> tools
  toolweb --> web[web/web]
  toolweb --> prompt
  toolweb --> scope
  search[web/web-search-tavily] --> web
  fetch[web/web-fetch-http] --> web

  llmdeepseek[llm/llm-deepseek] --> llm
```

## Layering rules

- `core/*` never imports a provider or a tool package.
- `llm/llm`, `fs/fs`, and `web/web` are definitions: they import only `cordis` (plus
  `schemastery` where they export a `Config` schema) and `core/scope`.
- Provider packages import their definition only.
- `tool-*` packages import definitions and `core/tools`, never a provider.
- Bundles are composition-only: their source carries no runtime API.
- `apps/cli` is the only package that knows about profiles and bundles.

## Bundles

`@coridis/base` mounts the shared rows. `@coridis/headless` mounts the startup provider and runner
and overrides `system-prompt` config. Neither bundle imports the packages it mounts; composition
happens through `cordis.patch.yml` `name` fields resolved at boot.

import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

/**
 * Tests run against package sources rather than `lib`, so `npm test` does not
 * require a build first. The more specific `headless/startup` entry must come
 * before the `headless` package root.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: '@coridis/headless/startup', replacement: source('./packages/bundle/headless/src/startup.ts') },
      { find: '@coridis/scope', replacement: source('./packages/core/scope/src/index.ts') },
      { find: '@coridis/session', replacement: source('./packages/core/session/src/index.ts') },
      { find: '@coridis/system-prompt', replacement: source('./packages/core/system-prompt/src/index.ts') },
      { find: '@coridis/tools', replacement: source('./packages/core/tools/src/index.ts') },
      { find: '@coridis/agent', replacement: source('./packages/core/agent/src/index.ts') },
      { find: '@coridis/agent-loop', replacement: source('./packages/core/agent-loop/src/index.ts') },
      { find: '@coridis/llm', replacement: source('./packages/llm/llm/src/index.ts') },
      { find: '@coridis/llm-deepseek', replacement: source('./packages/llm/llm-deepseek/src/index.ts') },
      { find: '@coridis/fs', replacement: source('./packages/fs/fs/src/index.ts') },
      { find: '@coridis/fs-local', replacement: source('./packages/fs/fs-local/src/index.ts') },
      { find: '@coridis/tool-fs', replacement: source('./packages/fs/tool-fs/src/index.ts') },
      { find: '@coridis/web', replacement: source('./packages/web/web/src/index.ts') },
      { find: '@coridis/web-search-tavily', replacement: source('./packages/web/web-search-tavily/src/index.ts') },
      { find: '@coridis/web-fetch-http', replacement: source('./packages/web/web-fetch-http/src/index.ts') },
      { find: '@coridis/tool-web', replacement: source('./packages/web/tool-web/src/index.ts') },
      { find: '@coridis/app-boot', replacement: source('./packages/boot/app-boot/src/index.ts') },
      { find: '@coridis/base', replacement: source('./packages/bundle/base/src/index.ts') },
      { find: '@coridis/headless', replacement: source('./packages/bundle/headless/src/index.ts') },
    ],
  },
  test: {
    include: ['tests/**/*.spec.ts', 'packages/**/tests/**/*.spec.ts', 'apps/**/tests/**/*.spec.ts'],
    passWithNoTests: true,
  },
})

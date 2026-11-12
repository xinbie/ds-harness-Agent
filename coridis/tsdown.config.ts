import { globSync } from 'node:fs'
import { defineConfig } from 'tsdown'

/**
 * Build every workspace package from the JavaScript that `tsc -b` emitted to
 * `lib/types`, bundling each package root as a self-contained ESM entry.
 */
export default defineConfig({
  workspace: [
    ...globSync(['packages/*/*/package.json'], { cwd: import.meta.dirname })
      .map(file => file.replace(/\/package\.json$/, '')),
    'apps/cli',
  ],
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  clean: false,
})

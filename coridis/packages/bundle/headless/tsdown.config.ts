import { defineConfig } from 'tsdown'

/** Headless ships both the runner (`index`) and its startup provider. */
export default defineConfig([
  {
    entry: ['lib/types/index.js', 'lib/types/startup.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])

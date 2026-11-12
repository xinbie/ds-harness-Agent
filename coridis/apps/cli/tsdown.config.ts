import { defineConfig } from 'tsdown'

/** The CLI's root entry is `bin`, not `index`; it keeps its node shebang. */
export default defineConfig([
  {
    entry: ['lib/types/bin.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])

import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // Emit .js/.d.ts (package is "type": "module") rather than tsdown's default .mjs/.d.mts,
  // so package.json's main/types/exports resolve.
  fixedExtension: false,
  // Declarations are bundled into dist/index.d.ts. With TypeScript 7 installed,
  // rolldown-plugin-dts selects its `tsgo` generator automatically.
  dts: true,
  sourcemap: false,
  clean: true,
})

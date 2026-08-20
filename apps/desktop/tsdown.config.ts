import { defineConfig } from 'tsdown'

/** Bundle the main process and the isolated terminal preload as separate runtime entries. */
export default defineConfig([
  {
    entry: ['lib/types/main.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron', 'node-pty'] },
  },
  {
    entry: { 'terminal-preload': 'lib/types/terminal-preload.js' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    outputOptions: { codeSplitting: false },
    dts: false,
    clean: false,
    deps: {
      neverBundle: ['electron'],
      alwaysBundle: ['@xterm/addon-fit', '@xterm/xterm'],
    },
  },
])

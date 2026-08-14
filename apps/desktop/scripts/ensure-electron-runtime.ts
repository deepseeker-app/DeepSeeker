/** Ensure Electron's platform binary exists before electron-builder uses electronDist. */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const electronPath: unknown = createRequire(import.meta.url)('electron')
if (typeof electronPath !== 'string' || !existsSync(electronPath)) {
  throw new Error('Electron platform binary is unavailable after package initialization')
}

console.log(`Electron runtime ready at ${electronPath}`)

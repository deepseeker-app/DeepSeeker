/** Reject a packaged desktop shell that omitted the staged Host entrypoints. */

import { listPackage } from '@electron/asar'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { AfterPackContext } from 'electron-builder'

const REQUIRED_HOST_FILES = [
  ['@deepseek-ai', 'dsh', 'lib', 'bin.js'],
  ['@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html'],
] as const

const REQUIRED_UNPACKED_APP_FILES = [
  ['node_modules', 'node-pty', 'package.json'],
  ['node_modules', 'node-pty', 'build', 'Release', 'pty.node'],
] as const

const REQUIRED_PACKED_APP_FILES = [
  ['lib', 'main.js'],
  ['lib', 'terminal-preload.cjs'],
  ['node_modules', '@xterm', 'xterm', 'css', 'xterm.css'],
] as const

/**
 * Convert ASAR entries to the archive's slash-separated path format.
 * @param path - A path returned by the platform-native ASAR reader.
 * @returns The portable archive entry path.
 */
export function normalizeAsarEntry(path: string): string {
  return path.replaceAll('\\', '/')
}

/**
 * Verify the Host files required before the signed application can start.
 * @param context - Electron Builder's completed application directory.
 * @returns A promise that rejects when a staged Host entrypoint is absent.
 */
export async function afterPack(context: AfterPackContext): Promise<void> {
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  for (const segments of REQUIRED_HOST_FILES) {
    await access(join(resources, 'host', 'node_modules', ...segments))
  }
  for (const segments of REQUIRED_UNPACKED_APP_FILES) {
    await access(join(resources, 'app.asar.unpacked', ...segments))
  }
  if (context.electronPlatformName === 'darwin') {
    await access(join(resources, 'app.asar.unpacked', 'node_modules', 'node-pty', 'build', 'Release', 'spawn-helper'))
  }
  const packedFiles = new Set(
    listPackage(join(resources, 'app.asar'), { isPack: false })
      .map(normalizeAsarEntry),
  )
  for (const segments of REQUIRED_PACKED_APP_FILES) {
    const path = `/${segments.join('/')}`
    if (!packedFiles.has(path)) throw new Error(`packaged desktop runtime is missing ${path}`)
  }
}

export default afterPack

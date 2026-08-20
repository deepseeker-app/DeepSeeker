import { createPackage } from '@electron/asar'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { afterPack, normalizeAsarEntry } from '../scripts/verify-packaged-runtime.ts'

function context(appOutDir: string, electronPlatformName = 'darwin') {
  return {
    appOutDir,
    electronPlatformName,
    packager: { appInfo: { productFilename: 'DeepSeeker' } },
  } as Parameters<typeof afterPack>[0]
}

describe('packaged desktop runtime verification', () => {
  it('normalizes Windows ASAR entries to portable archive paths', () => {
    expect(normalizeAsarEntry('\\lib\\main.js')).toBe('/lib/main.js')
  })

  it('accepts the packaged Host entrypoints and unpacked native terminal dependency', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'dsh-packaged-runtime-'))
    try {
      const resources = join(appOutDir, 'DeepSeeker.app', 'Contents', 'Resources', 'host', 'node_modules')
      const cli = join(resources, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      const web = join(resources, '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
      const appResources = join(appOutDir, 'DeepSeeker.app', 'Contents', 'Resources')
      const ptyRoot = join(appResources, 'app.asar.unpacked', 'node_modules', 'node-pty')
      const asarSource = join(appOutDir, 'asar-source')
      await mkdir(join(cli, '..'), { recursive: true })
      await mkdir(join(web, '..'), { recursive: true })
      await mkdir(join(ptyRoot, 'build', 'Release'), { recursive: true })
      await mkdir(join(asarSource, 'lib'), { recursive: true })
      await mkdir(join(asarSource, 'node_modules', '@xterm', 'xterm', 'css'), { recursive: true })
      await writeFile(cli, '')
      await writeFile(web, '')
      await writeFile(join(ptyRoot, 'package.json'), '{}')
      await writeFile(join(ptyRoot, 'build', 'Release', 'pty.node'), '')
      await writeFile(join(ptyRoot, 'build', 'Release', 'spawn-helper'), '')
      await writeFile(join(asarSource, 'lib', 'main.js'), '')
      await writeFile(join(asarSource, 'lib', 'terminal-preload.cjs'), '')
      await writeFile(join(asarSource, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css'), '')
      await createPackage(asarSource, join(appResources, 'app.asar'))

      await expect(afterPack(context(appOutDir))).resolves.toBeUndefined()
    } finally {
      await rm(appOutDir, { recursive: true, force: true })
    }
  })

  it('rejects a shell whose Host dependency tree was filtered out', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'dsh-packaged-runtime-'))
    try {
      await expect(afterPack(context(appOutDir))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(appOutDir, { recursive: true, force: true })
    }
  })
})

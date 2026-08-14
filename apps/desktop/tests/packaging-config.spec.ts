import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface DesktopPackage {
  readonly description: string
  readonly scripts: Readonly<Record<string, string>>
  readonly build: {
    readonly appId: string
    readonly productName: string
    readonly afterPack: string
    readonly electronDist: string
    readonly extraResources: readonly {
      readonly from: string
      readonly to: string
    }[]
    readonly mac: {
      readonly hardenedRuntime: boolean
      readonly icon: string
      readonly notarize: boolean
    }
    readonly win: { readonly icon: string }
  }
}

interface RootPackage {
  readonly scripts: Readonly<Record<string, string>>
}

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(desktopRoot, '../..')
const workspaceConfiguration = readFileSync(resolve(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')
const builderPatch = readFileSync(resolve(repositoryRoot, 'patches/app-builder-lib@26.15.3.patch'), 'utf8')
const stageRuntime = readFileSync(resolve(desktopRoot, 'scripts/stage-runtime.ts'), 'utf8')
const packageDesktop = readFileSync(resolve(desktopRoot, 'scripts/package-desktop.ts'), 'utf8')
const desktopPackage = JSON.parse(
  readFileSync(resolve(desktopRoot, 'package.json'), 'utf8'),
) as DesktopPackage
const rootPackage = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
) as RootPackage

describe('desktop packaging configuration', () => {
  it('ships the DeepSeeker product identity', () => {
    expect(desktopPackage.description).toBe('DeepSeeker desktop agent powered by DeepSeek Harness')
    expect(desktopPackage.build.appId).toBe('com.deepseeker.desktop')
    expect(desktopPackage.build.productName).toBe('DeepSeeker')
  })

  it('packages the installed Electron distribution', () => {
    expect(desktopPackage.build.electronDist).toBe('node_modules/electron/dist')
    expect(workspaceConfiguration).toContain("'app-builder-lib@26.15.3>@electron/get': '3.1.0'")
  })

  it('maps the staged Host node_modules directory as the copy root', () => {
    expect(desktopPackage.build.extraResources).toEqual(expect.arrayContaining([
      { from: 'runtime-host/package.json', to: 'host/package.json' },
      { from: 'runtime-host/node_modules', to: 'host/node_modules' },
    ]))
    expect(desktopPackage.build.afterPack).toBe('./scripts/verify-packaged-runtime.ts')
    expect(stageRuntime).toContain("'--config.allow-unused-patches=true'")
  })

  it('unlocks the temporary signing Keychain with its own password', () => {
    expect(workspaceConfiguration).toContain(
      'app-builder-lib@26.15.3: patches/app-builder-lib@26.15.3.patch',
    )
    expect(builderPatch).toContain('cscPasswords, keychainPassword')
    expect(builderPatch).toContain('"-k", keychainPassword, keychainFile')
  })

  it('keeps the supplied image byte-for-byte and shares it across macOS and Windows', () => {
    const icon = readFileSync(resolve(desktopRoot, 'build/icon.png'))

    expect(createHash('sha256').update(icon).digest('hex'))
      .toBe('cb344c36152b51860406fe69cbcd1d63a44f22132b896310a3230584def7a4e7')
    expect(desktopPackage.build.mac.icon).toBe('build/icon.png')
    expect(desktopPackage.build.win.icon).toBe('build/icon.png')
  })

  it('builds and stages the complete workspace before local packaging', () => {
    for (const name of ['package', 'dist']) {
      expect(desktopPackage.scripts[name]).toContain('pnpm --workspace-root run build')
      expect(desktopPackage.scripts[name]).toContain('scripts/stage-runtime.ts')
      expect(desktopPackage.scripts[name]).toContain('scripts/ensure-electron-runtime.ts')
    }
    expect(desktopPackage.scripts.package).toContain('scripts/package-desktop.ts')
    expect(desktopPackage.scripts.package).not.toContain('release-preflight.ts')
  })

  it('assembles macOS app bundles on internal temporary storage and returns one ZIP artifact', () => {
    expect(packageDesktop).toContain("mkdtempSync(join(tmpdir(), 'deepseeker-package.')")
    expect(packageDesktop).toContain('`--config.directories.output=${builderOutput}`')
    expect(packageDesktop).toContain("'-c', '-k', '--norsrc', '--keepParent'")
    expect(packageDesktop).toContain("'--keepParent', appPath, temporaryArchive")
    expect(packageDesktop).toContain("run('unzip', ['-tq', temporaryArchive]")
    expect(packageDesktop).toContain('copyFileSync(temporaryArchive, artifactPath)')
  })

  it('makes the macOS DMG path signed, hardened, and notarized', () => {
    const command = desktopPackage.scripts['dist:mac']

    expect(command).toBe('node --import tsx scripts/release-mac.ts')
    expect(desktopPackage.build.mac.hardenedRuntime).toBe(true)
    expect(desktopPackage.build.mac.notarize).toBe(true)
  })

  it('exposes generic and macOS release commands at the repository root', () => {
    expect(rootPackage.scripts['dist:desktop'])
      .toBe('pnpm --filter @deepseek-ai/dsh-desktop run dist')
    expect(rootPackage.scripts['dist:mac:desktop'])
      .toBe('pnpm --filter @deepseek-ai/dsh-desktop run dist:mac')
  })
})
